import {
  asUnknownRecord,
  assertPersonalBackupMatchesVault,
  BUILTIN_LIBRARY_DEFINITIONS,
  BUILTIN_LIBRARY_IDS,
  buildCurriculumTree,
  canonicalIdIsValid,
  childSubheadings,
  cleanLibraryLayouts,
  cleanLibraryNoteProfiles,
  cloneCollections,
  cloneCurriculumVisual,
  createPersonalBackup,
  createWorkspaceConfig,
  curriculumContainerKey,
  errorMessage,
  fingerprintText,
  isPortablePlaceholderPath,
  isSafeObjectKey,
  isValidLibraryId,
  LIBRARY_KINDS,
  LibraryDefinition,
  LibraryKind,
  LibraryLayouts,
  libraryIdFromTab,
  libraryTabId,
  LayoutHeading,
  LayoutSubheading,
  MainTab,
  makeId,
  MAX_LAYOUT_DEPTH,
  MAX_LIBRARIES,
  MAX_TRANSFER_COLLECTIONS,
  MAX_TRANSFER_LIST_ITEMS,
  MAX_TRANSFER_TOTAL_REFERENCES,
  normalizedNameKey,
  parsePersonalBackup,
  parseWorkspaceConfig,
  pathIsInsideFolder,
  PersonalBackup,
  PluginData,
  PortableGroupDefinition,
  portablePlaceholderPath,
  PortableSubjectDefinition,
  portableSubjectIdFromPath,
  RecordKind,
  reconcilePortableLibraryLayouts,
  recordBelongsToIndex,
  SavedView,
  subjectLibraryId,
  VaultRecord,
  WorkspaceConfig,
  WorkspaceMode,
} from "./model";
import { hasUnpairedSurrogate } from "./follow-up";

export const PORTABLE_EXPORT_KIND = "knowledge-base-command-center-portable-export" as const;
/**
 * Version 5 carries nested subheading hierarchies (up to MAX_LAYOUT_DEPTH
 * levels) in collections and library layouts. Older builds reject it rather
 * than silently flattening or discarding nested organization. Version 4 added
 * stable, user-defined library identities. The importer continues to accept
 * versions 1 through 4.
 */
export const PORTABLE_EXPORT_VERSION = 5 as const;
const LIBRARY_IDENTITY_PORTABLE_EXPORT_VERSION = 4 as const;
const LIBRARY_LAYOUT_PORTABLE_EXPORT_VERSION = 3 as const;
const CATALOG_PORTABLE_EXPORT_VERSION = 2 as const;
const LEGACY_PORTABLE_EXPORT_VERSION = 1 as const;
type PortableExportVersion = typeof LEGACY_PORTABLE_EXPORT_VERSION
  | typeof CATALOG_PORTABLE_EXPORT_VERSION
  | typeof LIBRARY_LAYOUT_PORTABLE_EXPORT_VERSION
  | typeof LIBRARY_IDENTITY_PORTABLE_EXPORT_VERSION
  | typeof PORTABLE_EXPORT_VERSION;
export const MAX_PORTABLE_PACKAGE_BYTES = 10 * 1024 * 1024;
const MAX_PORTABLE_GROUPS = 10_000;
const MAX_PORTABLE_SUBJECTS = 50_000;
const MAX_PORTABLE_COLLECTIONS = MAX_TRANSFER_COLLECTIONS;
const MAX_PORTABLE_TITLE_LENGTH = 1_000;
const MAX_PORTABLE_ID_LENGTH = 160;
const MAX_PORTABLE_DEPTH = 64;
const MAX_SAVED_VIEW_QUERY_LENGTH = 10_000;

export interface PortableExportSelection {
  workspace: boolean;
  index: boolean;
  /** Stable IDs of authoritative visual libraries selected for transfer. */
  libraryIds?: string[];
  /** @deprecated Compatibility inputs for callers that predate portable v4. */
  procedures?: boolean;
  /** @deprecated Compatibility inputs for callers that predate portable v4. */
  medications?: boolean;
  /** @deprecated Compatibility inputs for callers that predate portable v4. */
  syndromes?: boolean;
  collections: boolean;
  study: boolean;
  savedViews: boolean;
  recovery: boolean;
}

type NormalizedPortableExportSelection = Omit<PortableExportSelection, "libraryIds"> & { libraryIds: string[] };

export const COMPLETE_PORTABLE_SELECTION: PortableExportSelection = {
  workspace: true,
  index: true,
  libraryIds: [...LIBRARY_KINDS.map((kind) => BUILTIN_LIBRARY_IDS[kind])],
  procedures: true,
  medications: true,
  syndromes: true,
  collections: true,
  study: true,
  savedViews: true,
  recovery: false,
};

export const EMPTY_PORTABLE_SELECTION: PortableExportSelection = {
  workspace: false,
  index: false,
  libraryIds: [],
  procedures: false,
  medications: false,
  syndromes: false,
  collections: false,
  study: false,
  savedViews: false,
  recovery: false,
};

export interface PortableCatalogSelectionV1V3 {
  index: boolean;
  procedures: boolean;
  medications: boolean;
  syndromes: boolean;
}

export interface PortableCatalogSelection {
  index: boolean;
  libraryIds: string[];
  /** Legacy compatibility fields are populated only while parsing v1-v3. */
  procedures?: boolean;
  medications?: boolean;
  syndromes?: boolean;
}

export interface PortableLibraryDefinition {
  id: string;
  name: string;
  singularName: string;
  icon: string;
  order: number;
  sourceKind: LibraryKind | null;
}

export interface PortableIndexV1 {
  version: PortableExportVersion;
  groups: PortableGroupDefinition[];
  subjects: PortableSubjectDefinition[];
  /** Version 4 stable library definitions, including dependency descriptors. */
  libraries?: PortableLibraryDefinition[];
  /** Version 3+ path-free organization. Versions 1/2 are migrated to a flat layout on parse. */
  libraryLayouts?: LibraryLayouts;
  /** Version 2+ packages declare exactly which catalogs are authoritative. */
  includedSections?: PortableCatalogSelection;
  /** Transitional v1 exporters may declare whether the topic-index blueprint was selected. Older v1 packages imply true. */
  includeIndex?: boolean;
  /** Groups that belong to the topic index, excluding library-only group metadata. */
  indexGroupIds?: string[];
  /** Path-free view state. Optional so existing v1 packages remain valid. */
  collapsedGroupIds?: string[];
  /** Path-free view state. Optional so existing v1 packages remain valid. */
  collapsedSubjectIds?: string[];
}

export interface PortableCollectionSubheadingV1 {
  id: string;
  title: string;
  collapsed: boolean;
  subjectIds: string[];
  /**
   * Version 5+ nested children. Following the canonical layout convention the
   * key is present exactly when children exist; leaf subheadings omit it so
   * flat packages stay byte-identical across export/import round-trips.
   */
  subheadings?: PortableCollectionSubheadingV1[];
}

export interface PortableCollectionV1 {
  id: string;
  title: string;
  collapsed: boolean;
  subjectIds: string[];
  subheadings: PortableCollectionSubheadingV1[];
}

export interface PortableCollectionsV1 {
  version: 1;
  collections: PortableCollectionV1[];
}

export interface PortableStudyV1 {
  version: 1;
  pinnedSubjectIds: string[];
  nextSubjectIds: string[];
}

export interface PortableSavedViewsV1 {
  version: 1;
  views: SavedView[];
}

export interface PortableExportV1 {
  kind: typeof PORTABLE_EXPORT_KIND;
  version: PortableExportVersion;
  exportedAt: string;
  sourceWorkspace: string;
  components: {
    workspace?: WorkspaceConfig;
    index?: PortableIndexV1;
    collections?: PortableCollectionsV1;
    study?: PortableStudyV1;
    savedViews?: PortableSavedViewsV1;
    recovery?: PersonalBackup;
  };
}

export type PortableImportMode = "merge" | "replace";

export interface PortableImportResult {
  addedSubjects: number;
  updatedSubjects: number;
  matchedSubjects: number;
  unresolvedSubjects: number;
  importedCollections: number;
  importedViews: number;
}

export interface PortableExportSummary {
  groups: number;
  subjects: number;
  indexSubjects: number;
  procedures: number;
  medications: number;
  syndromes: number;
  libraries: Array<{
    id: string;
    name: string;
    subjects: number;
    headings: number;
  }>;
  placeholders: number;
  collections: number;
  pinned: number;
  next: number;
  views: number;
  hasRecovery: boolean;
}

export function serializePortableExport(value: PortableExportV1): string {
  const serialized = `${JSON.stringify(value, null, 2)}\n`;
  const byteLength = new TextEncoder().encode(serialized).byteLength;
  if (byteLength > MAX_PORTABLE_PACKAGE_BYTES) {
    throw new Error(`The selected export is ${(byteLength / 1024 / 1024).toFixed(1)} MB, above the 10 MB portable-package limit. Export fewer sections.`);
  }
  try {
    // Validate the exact JSON representation that will be downloaded or saved
    // so the plugin never hands out a package its own importer will reject.
    parsePortableExport(JSON.parse(serialized) as unknown);
  } catch (error) {
    const detail = errorMessage(error);
    throw new Error(`This export cannot be safely re-imported: ${detail}`);
  }
  return serialized;
}

function safeId(value: unknown, label: string): string {
  if (typeof value !== "string") throw new Error(`${label} must be text.`);
  const id = value.trim();
  if (!id || id.length > MAX_PORTABLE_ID_LENGTH || !isSafeObjectKey(id)) {
    throw new Error(`${label} is invalid.`);
  }
  if (!/^[\p{L}\p{N}._:@+-]+$/u.test(id)) throw new Error(`${label} contains unsupported characters.`);
  return id;
}

function safeTitle(value: unknown, label: string): string {
  if (typeof value !== "string") throw new Error(`${label} must be text.`);
  if (hasUnpairedSurrogate(value)) throw new Error(`${label} contains invalid Unicode.`);
  // Embedding, override, and isolate controls can visually reorder a title so
  // it appears to be a different record. Ordinary RTL text and direction marks
  // remain supported.
  if (/[\u202A-\u202E\u2066-\u2069]/u.test(value)) {
    throw new Error(`${label} contains unsupported bidirectional controls.`);
  }
  const title = value.trim().normalize("NFC");
  if (!title || title.length > MAX_PORTABLE_TITLE_LENGTH) throw new Error(`${label} is empty or too long.`);
  return title;
}

function safeOrder(value: unknown, fallback: number): number {
  const order = Number(value);
  return Number.isSafeInteger(order) && order >= 0 ? order : fallback;
}

function isRecordKind(value: unknown): value is RecordKind {
  return ["topic", "procedure", "medication", "syndrome", "proposal", "note"].includes(String(value));
}

function isMainTab(value: unknown): value is MainTab {
  return ["curriculum", "inbox", "collections", "queues"].includes(String(value))
    || libraryIdFromTab(value) !== null;
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

/** Depth-first visit of every layout node, including nested subheadings. */
function forEachLayoutNode(
  nodes: readonly (LayoutHeading | LayoutSubheading)[],
  visit: (node: LayoutHeading | LayoutSubheading) => void,
): void {
  for (const node of nodes) {
    visit(node);
    forEachLayoutNode(childSubheadings(node), visit);
  }
}

function countLayoutStructures(nodes: readonly (LayoutHeading | LayoutSubheading)[]): number {
  let count = 0;
  forEachLayoutNode(nodes, () => { count += 1; });
  return count;
}

/** Depth-first visit of a portable collection node and all nested children. */
function forEachPortableCollectionNode(
  node: PortableCollectionV1 | PortableCollectionSubheadingV1,
  visit: (node: PortableCollectionV1 | PortableCollectionSubheadingV1) => void,
): void {
  visit(node);
  for (const child of node.subheadings ?? []) forEachPortableCollectionNode(child, visit);
}

export function normalizePortableSelection(selection: PortableExportSelection): NormalizedPortableExportSelection {
  const rawSelection = asUnknownRecord(selection);
  const legacyIds = LIBRARY_KINDS
    .filter((kind) => rawSelection[`${kind}s`] === true)
    .map((kind) => BUILTIN_LIBRARY_IDS[kind]);
  const requestedIds = Array.isArray(selection.libraryIds) ? selection.libraryIds : [];
  const libraryIds = unique([...requestedIds, ...legacyIds].map((id) => {
    if (!isValidLibraryId(id)) throw new Error("The selected library has an invalid stable ID.");
    return id;
  }));
  const selected = new Set(libraryIds);
  return {
    ...EMPTY_PORTABLE_SELECTION,
    ...selection,
    libraryIds,
    procedures: selected.has(BUILTIN_LIBRARY_IDS.procedure),
    medications: selected.has(BUILTIN_LIBRARY_IDS.medication),
    syndromes: selected.has(BUILTIN_LIBRARY_IDS.syndrome),
  };
}

export function completePortableSelection(libraryIds: readonly string[]): NormalizedPortableExportSelection {
  return normalizePortableSelection({
    ...COMPLETE_PORTABLE_SELECTION,
    libraryIds: [...libraryIds],
    procedures: false,
    medications: false,
    syndromes: false,
  });
}

function selectionNeedsSubjectCatalog(selection: NormalizedPortableExportSelection): boolean {
  return selection.index
    || selection.libraryIds.length > 0
    || selection.collections
    || selection.study;
}

function libraryIdIsSelected(libraryId: string | null, selection: NormalizedPortableExportSelection): boolean {
  return Boolean(libraryId && selection.libraryIds.includes(libraryId));
}

type PortableCatalogScope = "index" | `library:${string}` | "other";

function portableCatalogScope(
  value: RecordKind | Pick<PortableSubjectDefinition, "indexed" | "libraryId" | "recordKind">,
): PortableCatalogScope {
  if (typeof value !== "string") {
    if (value.indexed) return "index";
    const libraryId = subjectLibraryId(value);
    return libraryId ? `library:${libraryId}` : "other";
  }
  if (value === "topic") return "index";
  if ((LIBRARY_KINDS as readonly RecordKind[]).includes(value)) {
    return `library:${BUILTIN_LIBRARY_IDS[value as LibraryKind]}`;
  }
  return "other";
}

function portableGroupScopes(
  subjects: readonly PortableSubjectDefinition[],
): Map<string, Set<PortableCatalogScope>> {
  const scopes = new Map<string, Set<PortableCatalogScope>>();
  for (const subject of subjects) {
    const groupScopes = scopes.get(subject.groupId) ?? new Set<PortableCatalogScope>();
    groupScopes.add(portableCatalogScope(subject));
    scopes.set(subject.groupId, groupScopes);
  }
  return scopes;
}

function catalogSelectionFromExport(selection: NormalizedPortableExportSelection): PortableCatalogSelection {
  return {
    index: selection.index,
    libraryIds: [...selection.libraryIds],
  };
}

function packageDeclaresCatalogs(version: PortableExportVersion): boolean {
  return version >= CATALOG_PORTABLE_EXPORT_VERSION;
}

function selectedLayoutSubheading(
  subheading: LayoutSubheading,
  includedIds: Set<string>,
): LayoutSubheading {
  // Preserve the canonical presence rule: the nested key exists exactly when
  // children exist, and filtering subjects never removes a child node.
  const selected: LayoutSubheading = {
    ...subheading,
    subjects: subheading.subjects.filter((subjectId) => includedIds.has(subjectId)),
  };
  if (subheading.subheadings) {
    selected.subheadings = subheading.subheadings.map((child) => selectedLayoutSubheading(child, includedIds));
  }
  return selected;
}

function selectedLibraryLayout(
  layouts: LibraryLayouts,
  libraryId: string,
  includedIds: Set<string>,
): LayoutHeading[] {
  return (layouts[libraryId] ?? []).map((heading) => ({
    ...heading,
    subjects: heading.subjects.filter((subjectId) => includedIds.has(subjectId)),
    subheadings: heading.subheadings.map((subheading) => selectedLayoutSubheading(subheading, includedIds)),
  }));
}

function portableLibraryLayoutsForSelection(
  layouts: LibraryLayouts,
  selection: NormalizedPortableExportSelection,
  includedIds: Set<string>,
): LibraryLayouts {
  const selected: LibraryLayouts = {};
  for (const libraryId of selection.libraryIds) {
    selected[libraryId] = selectedLibraryLayout(layouts, libraryId, includedIds);
  }
  return selected;
}

export function portableSelectionHasAny(selection: PortableExportSelection): boolean {
  const normalized = normalizePortableSelection(selection);
  return normalized.workspace
    || normalized.index
    || normalized.libraryIds.length > 0
    || normalized.collections
    || normalized.study
    || normalized.savedViews
    || normalized.recovery;
}

export function portableSubjectPath(data: PluginData, subjectId: string): string {
  const bindings = data.portableIndex.resolvedPathBySubjectId;
  const resolved = Object.prototype.hasOwnProperty.call(bindings, subjectId) ? bindings[subjectId] : "";
  return resolved || portablePlaceholderPath(subjectId);
}

function portableGroupsWithTitle(data: PluginData, title: string): PortableGroupDefinition[] {
  const normalized = normalizedNameKey(title);
  return data.portableIndex.groups.filter((group) => normalizedNameKey(group.title) === normalized);
}

function makePortableGroup(data: PluginData, title: string): PortableGroupDefinition {
  let id = makeId("group");
  const existingIds = new Set(data.portableIndex.groups.map((group) => group.id));
  while (existingIds.has(id)) id = makeId("group");
  const order = data.indexGroupOrder.findIndex((group) => normalizedNameKey(group) === normalizedNameKey(title));
  const group = {
    id,
    title,
    order: order >= 0 ? order : data.portableIndex.groups.length,
  };
  data.portableIndex.groups.push(group);
  return group;
}

function portableIndexGroupsWithTitle(data: PluginData, title: string): PortableGroupDefinition[] {
  const matches = portableGroupsWithTitle(data, title);
  const subjectsByGroup = new Map<string, PortableSubjectDefinition[]>();
  for (const subject of data.portableIndex.subjects) {
    const subjects = subjectsByGroup.get(subject.groupId) ?? [];
    subjects.push(subject);
    subjectsByGroup.set(subject.groupId, subjects);
  }
  const indexGroups: PortableGroupDefinition[] = [];
  for (const group of matches) {
    const subjects = subjectsByGroup.get(group.id) ?? [];
    const indexSubjects = subjects.filter((subject) => portableCatalogScope(subject) === "index");
    const nonIndexSubjects = subjects.filter((subject) => portableCatalogScope(subject) !== "index");
    if (indexSubjects.length > 0 && nonIndexSubjects.length > 0) {
      // Legacy packages could make the topic index and a library share one
      // group identity. The library keeps that historical identity; only topic
      // subjects move to a new index-owned group before an index edit proceeds.
      const split = makePortableGroup(data, group.title);
      for (const subject of indexSubjects) subject.groupId = split.id;
      indexGroups.push(split);
    } else if (indexSubjects.length > 0 || subjects.length === 0) {
      // A subject-free group is an explicitly created empty index heading.
      // Library headings live in libraryLayouts and do not allocate empty
      // PortableGroupDefinition entries.
      indexGroups.push(group);
    }
  }
  return indexGroups;
}

function collapsePortableIndexGroups(
  data: PluginData,
  keep: PortableGroupDefinition,
  duplicates: PortableGroupDefinition[],
): void {
  const duplicateIds = new Set(duplicates.filter((group) => group.id !== keep.id).map((group) => group.id));
  if (duplicateIds.size === 0) return;
  for (const subject of data.portableIndex.subjects) {
    if (duplicateIds.has(subject.groupId) && portableCatalogScope(subject) === "index") {
      subject.groupId = keep.id;
    }
  }
  const stillReferenced = new Set(data.portableIndex.subjects.map((subject) => subject.groupId));
  data.portableIndex.groups = data.portableIndex.groups.filter((group) => (
    !duplicateIds.has(group.id) || stillReferenced.has(group.id)
  ));
}

/** Register a user-created visual group even when it has no subjects yet. */
export function registerPortableGroup(data: PluginData, title: string): PortableGroupDefinition {
  const cleanTitle = title.trim() || "Ungrouped";
  const existing = portableIndexGroupsWithTitle(data, cleanTitle);
  if (existing[0]) {
    collapsePortableIndexGroups(data, existing[0], existing.slice(1));
    return existing[0];
  }
  return makePortableGroup(data, cleanTitle);
}

/** Rename a stable group, or merge it into an existing target group. */
export function renameOrMergePortableGroup(data: PluginData, sourceTitle: string, targetTitle: string): void {
  const source = portableIndexGroupsWithTitle(data, sourceTitle);
  const sourceIds = new Set(source.map((group) => group.id));
  const target = portableIndexGroupsWithTitle(data, targetTitle).filter((group) => !sourceIds.has(group.id));
  const keep = target[0] ?? source[0] ?? registerPortableGroup(data, targetTitle);
  keep.title = targetTitle.trim() || "Ungrouped";
  collapsePortableIndexGroups(data, keep, [...source, ...target.slice(1)]);
}

/**
 * Remove an actually empty stable group. A group still referenced by an
 * inactive portable subject remains internal so that subject can be restored;
 * export omits it unless that subject or the group itself is selected.
 */
export function removePortableGroup(data: PluginData, title: string): void {
  const matches = portableIndexGroupsWithTitle(data, title);
  if (matches.length === 0) return;
  const matchingIds = new Set(matches.map((group) => group.id));
  const referencedIds = new Set(data.portableIndex.subjects
    .filter((subject) => matchingIds.has(subject.groupId) && portableCatalogScope(subject) === "index")
    .map((subject) => subject.groupId));
  const keep = matches.find((group) => referencedIds.has(group.id));
  if (keep) {
    collapsePortableIndexGroups(data, keep, matches.filter((group) => group.id !== keep.id));
    return;
  }
  const allReferencedIds = new Set(data.portableIndex.subjects.map((subject) => subject.groupId));
  data.portableIndex.groups = data.portableIndex.groups.filter((group) => (
    !matchingIds.has(group.id) || allReferencedIds.has(group.id)
  ));
}

function fallbackTitle(path: string): string {
  return path.split("/").pop()?.replace(/\.md$/i, "").trim() || "Untitled subject";
}

/**
 * Allocates stable IDs once and refreshes only the safe subject catalog fields.
 * It never reads note contents. The caller saves plugin data before exporting.
 */
export function synchronizePortableRegistry(data: PluginData, records: VaultRecord[]): boolean {
  const before = JSON.stringify(data.portableIndex);
  const recordByPath = new Map(records.map((record) => [record.path, record]));
  const topicsOnly = data.settings.workspaceMode === "ent-clinical";
  const indexedPaths = new Set(records.filter((record) => recordBelongsToIndex(record, topicsOnly)).map((record) => record.path));
  for (const path of data.manualIndexPaths) if (isPortablePlaceholderPath(path)) indexedPaths.add(path);
  const requiredPaths = new Set<string>([
    ...indexedPaths,
    ...records
      .filter((record) => Boolean(record.libraryId)
        || record.kind === "procedure"
        || record.kind === "medication"
        || record.kind === "syndrome")
      .map((record) => record.path),
    ...data.pinnedPaths,
    ...data.nextStudyPaths,
  ]);
  forEachLayoutNode(data.collections, (node) => node.subjects.forEach((path) => requiredPaths.add(path)));

  const subjectById = new Map(data.portableIndex.subjects.map((subject) => [subject.id, subject]));
  // Group ownership must be claimed from the pre-scan catalog state. Clearing
  // index membership first makes every existing topic look like an unassigned
  // subject, so its group is claimed as `other` and a duplicate index group is
  // allocated below. That caused same-title group IDs to alternate on every
  // synchronization/export pass.
  const previousScopeBySubjectId = new Map(data.portableIndex.subjects
    .map((subject) => [subject.id, portableCatalogScope(subject)] as const));
  for (const subject of data.portableIndex.subjects) subject.indexed = false;
  const pathToId = new Map<string, string>();
  for (const [subjectId, path] of Object.entries(data.portableIndex.resolvedPathBySubjectId)) {
    if (!subjectById.has(subjectId) || pathToId.has(path) || isPortablePlaceholderPath(path)) {
      delete data.portableIndex.resolvedPathBySubjectId[subjectId];
      continue;
    }
    pathToId.set(path, subjectId);
  }

  const groupById = new Map<string, PortableGroupDefinition>();
  const unclaimedGroupsByTitle = new Map<string, PortableGroupDefinition[]>();
  for (const group of data.portableIndex.groups) {
    groupById.set(group.id, group);
    const key = normalizedNameKey(group.title);
    const candidates = unclaimedGroupsByTitle.get(key) ?? [];
    candidates.push(group);
    unclaimedGroupsByTitle.set(key, candidates);
  }
  const groupScopeById = new Map<string, PortableCatalogScope>();
  const groupByScopeAndTitle = new Map<string, PortableGroupDefinition>();
  const scopedGroupKey = (scope: PortableCatalogScope, title: string): string => `${scope}\0${normalizedNameKey(title)}`;
  const claimGroup = (scope: PortableCatalogScope, group: PortableGroupDefinition): boolean => {
    const claimedScope = groupScopeById.get(group.id);
    if (claimedScope && claimedScope !== scope) return false;
    const key = scopedGroupKey(scope, group.title);
    const existing = groupByScopeAndTitle.get(key);
    if (existing && existing.id !== group.id) return false;
    groupScopeById.set(group.id, scope);
    groupByScopeAndTitle.set(key, group);
    return true;
  };
  // Existing subjects claim their groups first. If legacy data shares one
  // group across catalogs, only the first catalog can keep that identity; the
  // other catalog receives a distinct same-title group below.
  for (const subject of data.portableIndex.subjects) {
    const group = groupById.get(subject.groupId);
    if (group) claimGroup(previousScopeBySubjectId.get(subject.id) ?? portableCatalogScope(subject), group);
  }
  const getGroup = (scope: PortableCatalogScope, title: string): PortableGroupDefinition => {
    const cleanTitle = title.trim() || "Ungrouped";
    const key = scopedGroupKey(scope, cleanTitle);
    const existing = groupByScopeAndTitle.get(key);
    if (existing) return existing;
    const unclaimed = unclaimedGroupsByTitle.get(normalizedNameKey(cleanTitle));
    let reusable: PortableGroupDefinition | undefined;
    while (unclaimed && unclaimed.length > 0 && !reusable) {
      const candidate = unclaimed.shift();
      if (candidate && !groupScopeById.has(candidate.id)) reusable = candidate;
    }
    if (reusable) {
      claimGroup(scope, reusable);
      return reusable;
    }
    let id = makeId("group");
    while (groupById.has(id)) id = makeId("group");
    const group = { id, title: cleanTitle, order: data.portableIndex.groups.length };
    data.portableIndex.groups.push(group);
    groupById.set(group.id, group);
    claimGroup(scope, group);
    return group;
  };

  // Normalize every retained identity, including unresolved placeholders that
  // are not part of this scan, so same-title groups never remain shared by two
  // independent catalogs.
  for (const subject of data.portableIndex.subjects) {
    const title = groupById.get(subject.groupId)?.title || "Ungrouped";
    subject.groupId = getGroup(previousScopeBySubjectId.get(subject.id) ?? portableCatalogScope(subject), title).id;
  }
  for (const title of data.indexGroupOrder) getGroup("index", title);

  for (const path of requiredPaths) {
    const placeholderId = portableSubjectIdFromPath(path);
    if (placeholderId && subjectById.has(placeholderId)) {
      const subject = subjectById.get(placeholderId);
      if (subject) {
        const libraryId = subjectLibraryId(subject);
        subject.indexed = !libraryId && subject.recordKind === "topic" && indexedPaths.has(path);
        subject.libraryId = libraryId;
        if (libraryId || subject.recordKind !== "topic") subject.parentId = null;
      }
      continue;
    }
    const record = recordByPath.get(path);
    let subjectId = pathToId.get(path);
    const boundSubject = subjectId ? subjectById.get(subjectId) : undefined;
    const boundDeclaresLibrary = Boolean(boundSubject
      && Object.prototype.hasOwnProperty.call(boundSubject, "libraryId"));
    const desiredLibraryId = record?.libraryId
      || (boundDeclaresLibrary && boundSubject
        ? subjectLibraryId(boundSubject)
        : record && (LIBRARY_KINDS as readonly RecordKind[]).includes(record.kind)
          ? BUILTIN_LIBRARY_IDS[record.kind as LibraryKind]
          : boundSubject ? subjectLibraryId(boundSubject) : null);
    const preserveGenericLibraryGroup = data.settings.workspaceMode === "generic"
      && boundSubject
      && Boolean(subjectLibraryId(boundSubject));
    const stableGroupTitle = preserveGenericLibraryGroup ? groupById.get(boundSubject.groupId)?.title ?? "" : "";
    const recordKind = record?.kind || boundSubject?.recordKind || "note";
    const group = getGroup(
      desiredLibraryId
        ? `library:${desiredLibraryId}`
        : indexedPaths.has(path) && recordKind === "topic" ? "index" : "other",
      stableGroupTitle || record?.domain || data.indexGroupByPath[path] || "Ungrouped",
    );
    // Never auto-bind an unresolved imported subject to a file merely because
    // metadata happens to match. Linking is an explicit user action; silently
    // binding here would leave placeholder memberships pointing at a dead path.
    if (!subjectId) {
      subjectId = makeId("subject");
      const subject: PortableSubjectDefinition = {
        id: subjectId,
        title: record?.title || fallbackTitle(path),
        groupId: group.id,
        parentId: null,
        order: data.portableIndex.subjects.length,
        indexed: indexedPaths.has(path),
        configuredId: record?.curriculumId || "",
        recordKind: record?.kind || "note",
        libraryId: desiredLibraryId,
      };
      data.portableIndex.subjects.push(subject);
      subjectById.set(subject.id, subject);
    }
    const subject = subjectById.get(subjectId);
    if (!subject) continue;
    data.portableIndex.resolvedPathBySubjectId[subject.id] = path;
    pathToId.set(path, subject.id);
    subject.title = record?.title || subject.title || fallbackTitle(path);
    subject.groupId = group.id;
    subject.indexed = !desiredLibraryId && indexedPaths.has(path);
    subject.configuredId = record?.curriculumId || subject.configuredId;
    subject.recordKind = record?.kind || subject.recordKind;
    subject.libraryId = desiredLibraryId;
    if (desiredLibraryId || subject.recordKind !== "topic") {
      subject.indexed = false;
      subject.parentId = null;
    }
  }

  // Refresh parent identities and sibling order from the effective visual tree.
  // A topic can be deliberately classified into a custom library. The visual
  // curriculum builder only understands source semantics, so feed it the
  // effective index set or it would silently pull that topic back into the
  // index and erase its explicit library assignment during export.
  const tree = buildCurriculumTree(
    records.filter((record) => recordBelongsToIndex(record, topicsOnly)),
    data.curriculumVisual,
    topicsOnly,
  );
  for (const domain of tree.domains) {
    const visit = (nodes: typeof domain.roots, parentId: string | null): void => {
      nodes.forEach((node, order) => {
        const subjectId = pathToId.get(node.record.path) || portableSubjectIdFromPath(node.record.path);
        const subject = subjectById.get(subjectId);
        if (subject) {
          subject.parentId = parentId;
          subject.order = order;
          subject.indexed = true;
          subject.libraryId = null;
          subject.groupId = getGroup("index", node.record.domain).id;
        }
        visit(node.children, subject?.id ?? parentId);
      });
    };
    visit(domain.roots, null);
  }

  // The index renders domains in the tree's effective folder order. In the ENT
  // preset that order comes from folders such as `01 Pediatric`, not from
  // `indexGroupOrder`, which is commonly empty. Persist the rendered order
  // first, followed by deliberately-created empty headings and then any
  // internal groups retained only for non-index organization.
  const renderedGroupKeys = new Set(tree.domains.map((domain) => normalizedNameKey(domain.domain)));
  const remainingGroups = [...data.portableIndex.groups]
    .sort((a, b) => a.order - b.order || a.title.localeCompare(b.title));
  const effectiveGroupTitles: string[] = [];
  const effectiveGroupKeys = new Set<string>();
  const addEffectiveGroup = (title: string): void => {
    const key = normalizedNameKey(title);
    if (!key || effectiveGroupKeys.has(key)) return;
    effectiveGroupKeys.add(key);
    effectiveGroupTitles.push(title);
  };
  tree.domains.forEach((domain) => addEffectiveGroup(domain.domain));
  data.indexGroupOrder
    .filter((title) => !renderedGroupKeys.has(normalizedNameKey(title)))
    .forEach(addEffectiveGroup);
  remainingGroups.forEach((group) => addEffectiveGroup(group.title));
  const orderByTitle = new Map(effectiveGroupTitles.map((title, order) => [normalizedNameKey(title), order]));
  data.portableIndex.groups.forEach((group, fallback) => {
    group.order = orderByTitle.get(normalizedNameKey(group.title)) ?? (effectiveGroupTitles.length + fallback);
  });
  data.portableIndex.groups.sort((a, b) => a.order - b.order || a.title.localeCompare(b.title));

  // Drop inactive identities so a note removed from every selected feature does
  // not remain permanently enumerated as a hidden vault-note record. Ancestors
  // of active subjects stay available so exported parent links remain valid.
  const activeIds = new Set<string>();
  for (const subject of data.portableIndex.subjects) if (subject.indexed) activeIds.add(subject.id);
  for (const path of requiredPaths) {
    const subjectId = pathToId.get(path) || portableSubjectIdFromPath(path);
    if (subjectId) activeIds.add(subjectId);
  }
  const activeStack = [...activeIds];
  while (activeStack.length > 0) {
    const subject = subjectById.get(activeStack.pop() ?? "");
    if (!subject?.parentId || activeIds.has(subject.parentId)) continue;
    activeIds.add(subject.parentId);
    activeStack.push(subject.parentId);
  }
  data.portableIndex.subjects = data.portableIndex.subjects.filter((subject) => activeIds.has(subject.id)
    || !data.portableIndex.resolvedPathBySubjectId[subject.id]);
  for (const subjectId of Object.keys(data.portableIndex.resolvedPathBySubjectId)) {
    if (!activeIds.has(subjectId)) delete data.portableIndex.resolvedPathBySubjectId[subjectId];
  }
  const survivingSubjectIds = new Set(data.portableIndex.subjects.map((subject) => subject.id));
  data.portableIndex.relinkableSubjectIds = [...new Set(data.portableIndex.relinkableSubjectIds ?? [])]
    .filter((subjectId) => survivingSubjectIds.has(subjectId)
      && Boolean(data.portableIndex.resolvedPathBySubjectId[subjectId]));
  const retainedGroupIds = new Set(data.portableIndex.subjects.map((subject) => subject.groupId));
  const retainedEmptyGroupTitles = new Set(data.indexGroupOrder.map(normalizedNameKey));
  data.portableIndex.groups = data.portableIndex.groups.filter((group) => retainedGroupIds.has(group.id)
    || retainedEmptyGroupTitles.has(normalizedNameKey(group.title)));
  reconcilePortableLibraryLayouts(data.portableIndex);
  return before !== JSON.stringify(data.portableIndex);
}

function pathMapForExport(data: PluginData): Map<string, string> {
  const map = new Map<string, string>();
  for (const subject of data.portableIndex.subjects) {
    map.set(portablePlaceholderPath(subject.id), subject.id);
    const path = data.portableIndex.resolvedPathBySubjectId[subject.id];
    if (path) map.set(path, subject.id);
  }
  return map;
}

function portableIndexGroupIdsForExport(data: PluginData): Set<string> {
  const subjectsByGroup = new Map<string, PortableSubjectDefinition[]>();
  for (const subject of data.portableIndex.subjects) {
    const subjects = subjectsByGroup.get(subject.groupId) ?? [];
    subjects.push(subject);
    subjectsByGroup.set(subject.groupId, subjects);
  }
  const selected = new Set(data.portableIndex.subjects
    .filter((subject) => subject.indexed)
    .map((subject) => subject.groupId));
  for (const title of data.indexGroupOrder) {
    const matches = portableGroupsWithTitle(data, title);
    const topicGroup = matches.find((group) => (subjectsByGroup.get(group.id) ?? [])
      .some((subject) => portableCatalogScope(subject) === "index"));
    const emptyGroup = matches.find((group) => !subjectsByGroup.has(group.id));
    const group = topicGroup ?? emptyGroup;
    if (group) selected.add(group.id);
  }
  return selected;
}

export function createPortableExport(
  data: PluginData,
  records: VaultRecord[],
  requestedSelection: PortableExportSelection,
  exportedAt: string,
  sourceVaultId = "",
  sourceBaseId = "",
  sourceBaseName = "",
): PortableExportV1 {
  const selection = normalizePortableSelection(requestedSelection);
  if (!portableSelectionHasAny(selection)) throw new Error("Choose at least one export component.");
  if (selectionNeedsSubjectCatalog(selection)) synchronizePortableRegistry(data, records);
  const libraryById = new Map(data.portableIndex.libraries.map((library) => [library.id, library]));
  const workspaceConfig = selection.workspace ? createWorkspaceConfig(data, exportedAt) : undefined;
  for (const libraryId of selection.libraryIds) {
    let library = libraryById.get(libraryId);
    const builtin = BUILTIN_LIBRARY_DEFINITIONS.find((definition) => definition.id === libraryId);
    if (!library && builtin) {
      library = { ...builtin };
      libraryById.set(library.id, library);
    }
    if (!library || library.archivedAt !== null) throw new Error(`Selected library ${libraryId} is not available in this knowledge base.`);
  }
  const pathToId = pathMapForExport(data);
  const referencedIds = new Set<string>();
  const addPaths = (paths: string[]): void => paths.forEach((path) => {
    const id = pathToId.get(path);
    if (id) referencedIds.add(id);
  });
  if (selection.collections) {
    forEachLayoutNode(data.collections, (node) => addPaths(node.subjects));
  }
  if (selection.study) {
    addPaths(data.pinnedPaths);
    addPaths(data.nextStudyPaths);
  }
  const includedIds = new Set(data.portableIndex.subjects
    .filter((subject) => (selection.index && subject.indexed)
      || libraryIdIsSelected(subjectLibraryId(subject), selection)
      || referencedIds.has(subject.id))
    .map((subject) => subject.id));
  const subjectById = new Map(data.portableIndex.subjects.map((subject) => [subject.id, subject]));
  if (selection.index) {
    const ancestorStack = [...includedIds];
    while (ancestorStack.length > 0) {
      const subject = subjectById.get(ancestorStack.pop() ?? "");
      if (!subject?.parentId || includedIds.has(subject.parentId)) continue;
      includedIds.add(subject.parentId);
      ancestorStack.push(subject.parentId);
    }
  }
  const groupTitleById = new Map(data.portableIndex.groups.map((group) => [group.id, group.title]));
  const subjects = data.portableIndex.subjects
    .filter((subject) => includedIds.has(subject.id))
    .map((subject) => ({
      ...subject,
      parentId: selection.index && subject.indexed ? subject.parentId : null,
      indexed: selection.index && subject.indexed,
      libraryId: subject.indexed ? null : subjectLibraryId(subject),
      // Generic ID properties are user-configurable and may contain paths or
      // private values. Only the fixed clinical curriculum ID is portable.
      configuredId: data.settings.workspaceMode === "ent-clinical"
        && data.settings.idProperty.trim() === "curriculum_id"
        && canonicalIdIsValid(subject.configuredId, groupTitleById.get(subject.groupId) ?? "")
        ? subject.configuredId.trim().toUpperCase()
        : "",
    }))
    .sort((a, b) => a.groupId.localeCompare(b.groupId) || a.parentId?.localeCompare(b.parentId ?? "") || a.order - b.order || a.title.localeCompare(b.title));
  const includedGroupIds = new Set(subjects.map((subject) => subject.groupId));
  const selectedIndexGroupIds = selection.index ? portableIndexGroupIdsForExport(data) : new Set<string>();
  const groups = data.portableIndex.groups
    .filter((group) => includedGroupIds.has(group.id)
      || selectedIndexGroupIds.has(group.id))
    .map((group) => ({ ...group }))
    .sort((a, b) => a.order - b.order || a.title.localeCompare(b.title));
  const indexGroupIds = selection.index ? groups
    .filter((group) => selectedIndexGroupIds.has(group.id))
    .map((group) => group.id) : [];
  const indexGroupIdSet = new Set(indexGroupIds);
  const groupById = new Map(groups.map((group) => [group.id, group]));
  const groupIdByTitle = new Map(indexGroupIds.map((groupId) => {
    const group = groupById.get(groupId);
    return [normalizedNameKey(group?.title ?? ""), groupId] as const;
  }));
  const collapsedGroupIds = unique(data.collapsed.curriculumDomains
    .map((title) => groupIdByTitle.get(normalizedNameKey(title)) ?? "")
    .filter((id) => selection.index && indexGroupIdSet.has(id)));
  const collapsedSubjectIds = selection.index ? unique(data.collapsed.curriculumNodes
    .map((path) => pathToId.get(path) ?? "")
    .filter((id) => includedIds.has(id) && subjectById.get(id)?.indexed)) : [];
  const dependencyLibraryIds = new Set<string>();
  for (const subject of subjects) {
    const libraryId = subjectLibraryId(subject);
    if (libraryId) dependencyLibraryIds.add(libraryId);
  }
  if (selection.workspace) {
    const libraryId = libraryIdFromTab(workspaceConfig?.settings.defaultTab);
    if (libraryId && libraryById.get(libraryId)?.archivedAt === null) dependencyLibraryIds.add(libraryId);
    Object.keys(workspaceConfig?.settings.libraryNoteProfiles ?? {}).forEach((profileLibraryId) => {
      if (libraryById.get(profileLibraryId)?.archivedAt === null) dependencyLibraryIds.add(profileLibraryId);
    });
  }
  if (selection.savedViews) {
    for (const view of data.savedViews) {
      const libraryId = libraryIdFromTab(view.tab);
      if (libraryId) dependencyLibraryIds.add(libraryId);
    }
  }
  selection.libraryIds.forEach((libraryId) => dependencyLibraryIds.add(libraryId));
  const libraries: PortableLibraryDefinition[] = [...dependencyLibraryIds]
    .map((libraryId) => libraryById.get(libraryId))
    .filter((library): library is LibraryDefinition => Boolean(library))
    .map(({ id, name, singularName, icon, order, sourceKind }) => ({ id, name, singularName, icon, order, sourceKind }))
    .sort((left, right) => left.order - right.order || left.name.localeCompare(right.name) || left.id.localeCompare(right.id));
  const needsIndexComponent = selectionNeedsSubjectCatalog(selection) || libraries.length > 0;
  const components: PortableExportV1["components"] = {};
  if (workspaceConfig) components.workspace = workspaceConfig;
  if (needsIndexComponent) {
    components.index = {
      version: PORTABLE_EXPORT_VERSION,
      groups,
      subjects,
      libraries,
      libraryLayouts: portableLibraryLayoutsForSelection(data.portableIndex.libraryLayouts, selection, includedIds),
      includedSections: catalogSelectionFromExport(selection),
      includeIndex: selection.index,
      indexGroupIds,
      collapsedGroupIds,
      collapsedSubjectIds,
    };
  }
  if (selection.collections) {
    const portableSubjectIds = (paths: string[]): string[] => (
      unique(paths.map((path) => pathToId.get(path) || "").filter((id) => includedIds.has(id)))
    );
    const portableSubheading = (subheading: LayoutSubheading): PortableCollectionSubheadingV1 => {
      const children = childSubheadings(subheading);
      return {
        id: subheading.id,
        title: subheading.title,
        collapsed: subheading.collapsed,
        subjectIds: portableSubjectIds(subheading.subjects),
        ...(children.length > 0 ? { subheadings: children.map(portableSubheading) } : {}),
      };
    };
    components.collections = {
      version: 1,
      collections: data.collections.map((heading) => ({
        id: heading.id,
        title: heading.title,
        collapsed: heading.collapsed,
        subjectIds: portableSubjectIds(heading.subjects),
        subheadings: heading.subheadings.map(portableSubheading),
      })),
    };
  }
  if (selection.study) {
    components.study = {
      version: 1,
      pinnedSubjectIds: unique(data.pinnedPaths.map((path) => pathToId.get(path) || "").filter((id) => includedIds.has(id))),
      nextSubjectIds: unique(data.nextStudyPaths.map((path) => pathToId.get(path) || "").filter((id) => includedIds.has(id))),
    };
  }
  if (selection.savedViews) components.savedViews = { version: 1, views: data.savedViews.map((view) => ({ ...view })) };
  if (selection.recovery) {
    components.recovery = createPersonalBackup(data, exportedAt, sourceVaultId, sourceBaseId, sourceBaseName);
  }
  return {
    kind: PORTABLE_EXPORT_KIND,
    version: PORTABLE_EXPORT_VERSION,
    exportedAt,
    sourceWorkspace: selection.workspace ? data.settings.workspaceName : "",
    components,
  };
}

function portableLibraryDefinition(definition: LibraryDefinition): PortableLibraryDefinition {
  const { id, name, singularName, icon, order, sourceKind } = definition;
  return { id, name, singularName, icon, order, sourceKind };
}

function legacyPortableLibraries(
  subjects: readonly PortableSubjectDefinition[],
  selectedIds: readonly string[],
  includeAllBuiltins: boolean,
): PortableLibraryDefinition[] {
  const needed = new Set(selectedIds);
  for (const subject of subjects) {
    const libraryId = subjectLibraryId(subject);
    if (libraryId) needed.add(libraryId);
  }
  return BUILTIN_LIBRARY_DEFINITIONS
    .filter((definition) => includeAllBuiltins || needed.has(definition.id))
    .map((definition) => portableLibraryDefinition(definition));
}

function parsePortableLibraries(input: unknown): PortableLibraryDefinition[] {
  if (!Array.isArray(input)) throw new Error("Portable version 4+ subject catalogs are missing library definitions.");
  if (input.length > MAX_LIBRARIES) throw new Error(`A portable package can contain at most ${MAX_LIBRARIES} libraries.`);
  const libraries: PortableLibraryDefinition[] = [];
  const ids = new Set<string>();
  for (const [index, raw] of input.entries()) {
    const value = asUnknownRecord(raw);
    const id = safeId(value.id, `Library ${index + 1} ID`);
    if (!isValidLibraryId(id)) throw new Error(`Library ${index + 1} ID is invalid.`);
    if (ids.has(id)) throw new Error(`Duplicate library ID: ${id}`);
    ids.add(id);
    const name = safeTitle(value.name, `Library ${id} name`);
    const singularName = safeTitle(value.singularName, `Library ${id} singular name`);
    if (name.length > 100 || singularName.length > 100) throw new Error(`Library ${id} name is too long.`);
    if (typeof value.icon !== "string" || !/^[a-z0-9-]{1,64}$/i.test(value.icon)) {
      throw new Error(`Library ${id} icon is invalid.`);
    }
    const sourceKind = value.sourceKind === null
      ? null
      : (LIBRARY_KINDS as readonly unknown[]).includes(value.sourceKind)
        ? value.sourceKind as LibraryKind
        : undefined;
    if (sourceKind === undefined) throw new Error(`Library ${id} source kind is invalid.`);
    const builtinKind = LIBRARY_KINDS.find((kind) => BUILTIN_LIBRARY_IDS[kind] === id) ?? null;
    if ((builtinKind && sourceKind !== builtinKind) || (!builtinKind && sourceKind !== null)) {
      throw new Error(`Library ${id} conflicts with a reserved built-in identity.`);
    }
    libraries.push({ id, name, singularName, icon: value.icon, order: safeOrder(value.order, index), sourceKind });
  }
  return libraries;
}

function parsePortableIndex(
  input: unknown,
  packageVersion: PortableExportVersion,
  referenceBudget: PortableReferenceBudget,
): PortableIndexV1 {
  const value = asUnknownRecord(input);
  if (value.version !== packageVersion || !Array.isArray(value.groups) || !Array.isArray(value.subjects)) {
    throw new Error("Unsupported portable index blueprint.");
  }
  if (value.groups.length > MAX_PORTABLE_GROUPS || value.subjects.length > MAX_PORTABLE_SUBJECTS) {
    throw new Error("The portable index is too large.");
  }
  const groups: PortableGroupDefinition[] = [];
  const groupIds = new Set<string>();
  for (const [index, raw] of value.groups.entries()) {
    const group = asUnknownRecord(raw);
    const id = safeId(group.id, `Group ${index + 1} ID`);
    if (groupIds.has(id)) throw new Error(`Duplicate group ID: ${id}`);
    groupIds.add(id);
    groups.push({ id, title: safeTitle(group.title, `Group ${index + 1} title`), order: safeOrder(group.order, index) });
  }
  let libraries = packageVersion >= LIBRARY_IDENTITY_PORTABLE_EXPORT_VERSION ? parsePortableLibraries(value.libraries) : [];
  const subjects: PortableSubjectDefinition[] = [];
  const subjectIds = new Set<string>();
  for (const [index, raw] of value.subjects.entries()) {
    const subject = asUnknownRecord(raw);
    const id = safeId(subject.id, `Subject ${index + 1} ID`);
    if (subjectIds.has(id)) throw new Error(`Duplicate subject ID: ${id}`);
    const groupId = safeId(subject.groupId, `Subject ${index + 1} group ID`);
    if (!groupIds.has(groupId)) throw new Error(`Subject ${id} references an unknown group.`);
    const rawParentId = subject.parentId === null || subject.parentId === undefined
      ? null
      : safeId(subject.parentId, `Subject ${id} parent ID`);
    if (packageVersion >= LIBRARY_IDENTITY_PORTABLE_EXPORT_VERSION && !isRecordKind(subject.recordKind)) {
      throw new Error(`Subject ${id} has an unsupported record kind.`);
    }
    if (subject.recordKind !== undefined && !isRecordKind(subject.recordKind)) {
      throw new Error(`Subject ${id} has an unsupported record kind.`);
    }
    const recordKind = isRecordKind(subject.recordKind) ? subject.recordKind : "topic";
    const configuredId = typeof subject.configuredId === "string" ? subject.configuredId.trim() : "";
    if (configuredId.length > MAX_PORTABLE_TITLE_LENGTH) throw new Error(`Subject ${id} configured ID is too long.`);
    let libraryId: string | null;
    let indexed: boolean;
    if (packageVersion >= LIBRARY_IDENTITY_PORTABLE_EXPORT_VERSION) {
      if (!Object.prototype.hasOwnProperty.call(subject, "libraryId")) {
        throw new Error(`Subject ${id} must declare libraryId in portable version ${packageVersion}.`);
      }
      if (subject.libraryId === null) libraryId = null;
      else {
        libraryId = safeId(subject.libraryId, `Subject ${id} library ID`);
        if (!isValidLibraryId(libraryId)) throw new Error(`Subject ${id} library ID is invalid.`);
      }
      if (typeof subject.indexed !== "boolean") throw new Error(`Subject ${id} indexed must be true or false.`);
      indexed = subject.indexed;
      if (indexed && libraryId) throw new Error(`Subject ${id} cannot belong to the index and a library.`);
      if (!indexed && rawParentId) throw new Error(`Non-index subject ${id} cannot declare a parent.`);
    } else {
      libraryId = (LIBRARY_KINDS as readonly RecordKind[]).includes(recordKind)
        ? BUILTIN_LIBRARY_IDS[recordKind as LibraryKind]
        : null;
      indexed = recordKind === "topic" && subject.indexed !== false;
    }
    subjectIds.add(id);
    subjects.push({
      id,
      title: safeTitle(subject.title, `Subject ${index + 1} title`),
      groupId,
      parentId: indexed ? rawParentId : null,
      order: safeOrder(subject.order, index),
      indexed,
      configuredId,
      recordKind,
      libraryId,
    });
  }
  const byId = new Map(subjects.map((subject) => [subject.id, subject]));
  for (const subject of subjects) {
    if (!subject.parentId) continue;
    const parent = byId.get(subject.parentId);
    if (!parent) throw new Error(`Subject ${subject.id} references an unknown parent.`);
    if (parent.id === subject.id) throw new Error(`Subject ${subject.id} cannot be its own parent.`);
    if (parent.groupId !== subject.groupId) throw new Error(`Subject ${subject.id} and its parent are in different groups.`);
    if (!parent.indexed) throw new Error(`Subject ${subject.id} references a parent outside the index.`);
  }
  const depthById = new Map<string, number>();
  for (const subject of subjects) {
    if (depthById.has(subject.id)) continue;
    const chain: string[] = [];
    const positions = new Map<string, number>();
    let cursor: PortableSubjectDefinition | undefined = subject;
    while (cursor && !depthById.has(cursor.id)) {
      const position = positions.get(cursor.id);
      if (position !== undefined) throw new Error(`Portable index hierarchy contains a cycle at ${cursor.id}.`);
      positions.set(cursor.id, chain.length);
      chain.push(cursor.id);
      cursor = cursor.parentId ? byId.get(cursor.parentId) : undefined;
    }
    let depth = cursor ? depthById.get(cursor.id) ?? 0 : 0;
    for (let index = chain.length - 1; index >= 0; index -= 1) {
      const id = chain[index];
      if (!id) continue;
      depth += 1;
      if (depth > MAX_PORTABLE_DEPTH) throw new Error(`Portable index hierarchy exceeds ${MAX_PORTABLE_DEPTH} levels.`);
      depthById.set(id, depth);
    }
  }
  const parseKnownIds = (
    inputIds: unknown,
    knownIds: Set<string>,
    label: string,
    maximum: number,
  ): string[] | undefined => {
    if (inputIds === undefined) return undefined;
    if (!Array.isArray(inputIds)) throw new Error(`${label} must be a list.`);
    if (inputIds.length > maximum) throw new Error(`${label} has too many entries.`);
    const ids: string[] = [];
    const seen = new Set<string>();
    for (const [index, rawId] of inputIds.entries()) {
      const id = safeId(rawId, `${label} ${index + 1}`);
      if (!knownIds.has(id)) throw new Error(`${label} references unknown ID ${id}.`);
      if (seen.has(id)) continue;
      seen.add(id);
      ids.push(id);
    }
    return ids;
  };
  const collapsedGroupIds = parseKnownIds(value.collapsedGroupIds, groupIds, "Collapsed index groups", MAX_PORTABLE_GROUPS);
  const collapsedSubjectIds = parseKnownIds(value.collapsedSubjectIds, subjectIds, "Collapsed index subjects", MAX_PORTABLE_SUBJECTS);
  if (value.includeIndex !== undefined && typeof value.includeIndex !== "boolean") {
    throw new Error("Portable index includeIndex must be true or false.");
  }
  const indexGroupIds = parseKnownIds(value.indexGroupIds, groupIds, "Index blueprint groups", MAX_PORTABLE_GROUPS);
  let includedSections: PortableCatalogSelection | undefined;
  if (packageDeclaresCatalogs(packageVersion)) {
    if (!value.includedSections || typeof value.includedSections !== "object" || Array.isArray(value.includedSections)) {
      throw new Error(`Portable version ${packageVersion} subject catalogs must declare includedSections.`);
    }
    const rawSections = value.includedSections as Record<string, unknown>;
    if (typeof rawSections.index !== "boolean") throw new Error("Portable includedSections.index must be true or false.");
    if (packageVersion >= LIBRARY_IDENTITY_PORTABLE_EXPORT_VERSION) {
      if (!Array.isArray(rawSections.libraryIds)) throw new Error("Portable includedSections.libraryIds must be a list.");
      if (rawSections.libraryIds.length > MAX_LIBRARIES) throw new Error("Portable includedSections.libraryIds has too many entries.");
      const libraryIds: string[] = [];
      const seen = new Set<string>();
      const knownLibraryIds = new Set(libraries.map((library) => library.id));
      for (const [index, rawId] of rawSections.libraryIds.entries()) {
        const id = safeId(rawId, `Included library ${index + 1} ID`);
        if (!isValidLibraryId(id)) throw new Error("An included library has an invalid stable ID.");
        if (seen.has(id)) throw new Error(`Duplicate included library ID: ${id}`);
        if (!knownLibraryIds.has(id)) throw new Error(`Included library ${id} has no definition.`);
        seen.add(id);
        libraryIds.push(id);
      }
      includedSections = { index: rawSections.index, libraryIds };
    } else {
      const readLegacy = (key: keyof Omit<PortableCatalogSelectionV1V3, "index">): boolean => {
        if (typeof rawSections[key] !== "boolean") throw new Error(`Portable includedSections.${key} must be true or false.`);
        return rawSections[key];
      };
      const procedures = readLegacy("procedures");
      const medications = readLegacy("medications");
      const syndromes = readLegacy("syndromes");
      includedSections = {
        index: rawSections.index,
        libraryIds: [
          ...(procedures ? [BUILTIN_LIBRARY_IDS.procedure] : []),
          ...(medications ? [BUILTIN_LIBRARY_IDS.medication] : []),
          ...(syndromes ? [BUILTIN_LIBRARY_IDS.syndrome] : []),
        ],
        procedures,
        medications,
        syndromes,
      };
    }
    if (typeof value.includeIndex === "boolean" && value.includeIndex !== includedSections.index) {
      throw new Error("Portable index includeIndex conflicts with includedSections.index.");
    }
    if (!includedSections.index && (indexGroupIds?.length ?? 0) > 0) {
      throw new Error("A package without the index blueprint cannot declare index groups.");
    }
  }
  const selectedLibraryIds = includedSections?.libraryIds ?? [];
  if (packageVersion < LIBRARY_IDENTITY_PORTABLE_EXPORT_VERSION) {
    libraries = legacyPortableLibraries(
      subjects,
      selectedLibraryIds,
      packageVersion === LIBRARY_LAYOUT_PORTABLE_EXPORT_VERSION,
    );
  }
  const knownLibraryIds = new Set(libraries.map((library) => library.id));
  for (const subject of subjects) {
    const libraryId = subjectLibraryId(subject);
    if (libraryId && !knownLibraryIds.has(libraryId)) {
      throw new Error(`Subject ${subject.id} references unknown library ${libraryId}.`);
    }
  }
  if (packageVersion >= LIBRARY_IDENTITY_PORTABLE_EXPORT_VERSION) {
    for (const [groupId, scopes] of portableGroupScopes(subjects)) {
      if (scopes.size > 1) throw new Error(`Group ${groupId} is shared by more than one catalog scope.`);
    }
  }
  let libraryLayouts: LibraryLayouts;
  if (packageVersion >= LIBRARY_IDENTITY_PORTABLE_EXPORT_VERSION) {
    libraryLayouts = parsePortableLibraryLayouts(
      value.libraryLayouts,
      subjects,
      selectedLibraryIds,
      referenceBudget,
      true,
    );
  } else if (packageVersion === LIBRARY_LAYOUT_PORTABLE_EXPORT_VERSION) {
    libraryLayouts = parsePortableLibraryLayouts(
      value.libraryLayouts,
      subjects,
      LIBRARY_KINDS.map((kind) => BUILTIN_LIBRARY_IDS[kind]),
      referenceBudget,
      true,
    );
    for (const libraryId of Object.keys(libraryLayouts)) {
      if (!selectedLibraryIds.includes(libraryId)) libraryLayouts[libraryId] = [];
    }
  } else {
    const localDefinitions: LibraryDefinition[] = libraries.map((library) => ({ ...library, archivedAt: null }));
    libraryLayouts = cleanLibraryLayouts(undefined, groups, subjects, localDefinitions);
    if (includedSections) {
      for (const libraryId of Object.keys(libraryLayouts)) {
        if (!selectedLibraryIds.includes(libraryId)) libraryLayouts[libraryId] = [];
      }
    }
  }
  return {
    version: packageVersion,
    groups,
    subjects,
    libraries,
    libraryLayouts,
    ...(includedSections ? { includedSections } : {}),
    ...(typeof value.includeIndex === "boolean" ? { includeIndex: value.includeIndex } : {}),
    ...(indexGroupIds ? { indexGroupIds } : {}),
    ...(collapsedGroupIds ? { collapsedGroupIds } : {}),
    ...(collapsedSubjectIds ? { collapsedSubjectIds } : {}),
  };
}

interface PortableReferenceBudget {
  total: number;
}

function parseSubjectIds(input: unknown, known: Set<string>, label: string, budget: PortableReferenceBudget): string[] {
  if (!Array.isArray(input)) throw new Error(`${label} must be a list.`);
  if (input.length > MAX_TRANSFER_LIST_ITEMS) throw new Error(`${label} has too many references.`);
  if (budget.total > MAX_TRANSFER_TOTAL_REFERENCES - input.length) {
    throw new Error(`The portable package contains more than ${MAX_TRANSFER_TOTAL_REFERENCES.toLocaleString()} subject references.`);
  }
  budget.total += input.length;
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const [index, rawId] of input.entries()) {
    const id = safeId(rawId, `${label} ${index + 1}`);
    if (!known.has(id)) throw new Error(`${label} references unknown subject ${id}.`);
    if (seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  return ids;
}

function parsePortableLibraryLayouts(
  input: unknown,
  subjects: PortableSubjectDefinition[],
  libraryIds: readonly string[],
  budget: PortableReferenceBudget,
  requireExactKeys: boolean,
): LibraryLayouts {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("Portable subject catalogs are missing libraryLayouts.");
  }
  const value = input as Record<string, unknown>;
  const knownSubjects = new Set(subjects.map((subject) => subject.id));
  const libraryBySubjectId = new Map(subjects.map((subject) => [subject.id, subjectLibraryId(subject)]));
  const expectedLibraryIds = new Set(libraryIds);
  if (requireExactKeys) {
    for (const key of Object.keys(value)) {
      if (!isValidLibraryId(key) || !expectedLibraryIds.has(key)) {
        throw new Error(`Portable library layout ${key} is not an included library.`);
      }
    }
  }
  let structureCount = 0;
  const chargeStructure = (): void => {
    structureCount += 1;
    if (structureCount > MAX_PORTABLE_COLLECTIONS) throw new Error("Portable library layouts have too many headings and subheadings.");
  };
  const parsed: LibraryLayouts = {};
  for (const libraryId of libraryIds) {
    const rawLayout = value[libraryId];
    if (!Array.isArray(rawLayout)) throw new Error(`Portable ${libraryId} layout must be a list.`);
    if (rawLayout.length > MAX_PORTABLE_COLLECTIONS) throw new Error(`Portable ${libraryId} layout has too many headings.`);
    const structureIds = new Set<string>();
    const placed = new Set<string>();
    const claimStructureId = (rawId: unknown, label: string): string => {
      const id = safeId(rawId, label);
      if (structureIds.has(id)) throw new Error(`Duplicate ${libraryId} layout ID: ${id}`);
      structureIds.add(id);
      return id;
    };
    const parseNodeSubjects = (rawSubjects: unknown, label: string): string[] => (
      parseSubjectIds(rawSubjects, knownSubjects, `${label} subjects`, budget).filter((subjectId) => {
        if (libraryBySubjectId.get(subjectId) !== libraryId) {
          throw new Error(`${label} references a subject from another library.`);
        }
        if (placed.has(subjectId)) throw new Error(`${libraryId} subject ${subjectId} appears more than once in its library layout.`);
        placed.add(subjectId);
        return true;
      })
    );
    /**
     * Depth-capped content is merged upward instead of lost, mirroring the
     * canonical cleaner: every node past MAX_LAYOUT_DEPTH contributes its
     * subjects, in document order, to the nearest allowed ancestor. Budget
     * and identity rules still apply to every visited node.
     */
    const parseNestedSubheadings = (
      input: unknown,
      depth: number,
      parentLabel: string,
      parentSubjects: string[],
    ): LayoutSubheading[] => {
      if (input === undefined) return [];
      if (!Array.isArray(input)) throw new Error(`${parentLabel} subheadings must be a list.`);
      if (depth > MAX_PORTABLE_DEPTH) throw new Error(`Portable library subheadings exceed ${MAX_PORTABLE_DEPTH} levels.`);
      if (depth > MAX_LAYOUT_DEPTH) {
        for (const [index, rawSubheading] of input.entries()) {
          chargeStructure();
          const subheading = asUnknownRecord(rawSubheading);
          const subheadingId = claimStructureId(subheading.id, `${parentLabel} subheading ${index + 1} ID`);
          safeTitle(subheading.title, `${libraryId} subheading ${subheadingId} title`);
          // The global `placed` set already deduplicates merged subjects.
          parentSubjects.push(...parseNodeSubjects(subheading.subjects, `${libraryId} subheading ${subheadingId}`));
          parseNestedSubheadings(subheading.subheadings, depth + 1, `${libraryId} subheading ${subheadingId}`, parentSubjects);
        }
        return [];
      }
      return input.map((rawSubheading, index) => {
        chargeStructure();
        const subheading = asUnknownRecord(rawSubheading);
        const subheadingId = claimStructureId(subheading.id, `${parentLabel} subheading ${index + 1} ID`);
        const subjects = parseNodeSubjects(subheading.subjects, `${libraryId} subheading ${subheadingId}`);
        const nested = parseNestedSubheadings(
          subheading.subheadings,
          depth + 1,
          `${libraryId} subheading ${subheadingId}`,
          subjects,
        );
        return {
          id: subheadingId,
          title: safeTitle(subheading.title, `${libraryId} subheading ${subheadingId} title`),
          collapsed: subheading.collapsed === true,
          subjects,
          ...(nested.length > 0 ? { subheadings: nested } : {}),
        };
      });
    };
    parsed[libraryId] = rawLayout.map((rawHeading, headingIndex) => {
      chargeStructure();
      const heading = asUnknownRecord(rawHeading);
      const id = claimStructureId(heading.id, `${libraryId} heading ${headingIndex + 1} ID`);
      if (!Array.isArray(heading.subheadings)) throw new Error(`${libraryId} heading ${id} subheadings must be a list.`);
      const directSubjects = parseNodeSubjects(heading.subjects, `${libraryId} heading ${id}`);
      const subheadings = parseNestedSubheadings(heading.subheadings, 2, `${libraryId} heading ${id}`, directSubjects);
      return {
        id,
        title: safeTitle(heading.title, `${libraryId} heading ${id} title`),
        collapsed: heading.collapsed === true,
        subjects: directSubjects,
        subheadings,
      };
    });
  }
  return parsed;
}

function parsePortableCollections(input: unknown, known: Set<string>, budget: PortableReferenceBudget): PortableCollectionsV1 {
  const value = asUnknownRecord(input);
  if (value.version !== 1 || !Array.isArray(value.collections) || value.collections.length > MAX_PORTABLE_COLLECTIONS) {
    throw new Error("Unsupported portable collections component.");
  }
  const structureIds = new Set<string>();
  let subheadingCount = 0;
  const claimStructureId = (rawId: unknown, label: string): string => {
    const id = safeId(rawId, label);
    if (structureIds.has(id)) throw new Error(`Duplicate collection or subheading ID: ${id}`);
    structureIds.add(id);
    return id;
  };
  /**
   * Depth-capped content is merged upward instead of lost, mirroring the
   * canonical cleaner: every node past MAX_LAYOUT_DEPTH contributes its
   * subjects, deduplicated and in document order, to the nearest allowed
   * ancestor. Budget and identity rules still apply to every visited node.
   * One `seen` set, seeded from the depth-cap ancestor's subjects, is threaded
   * through the whole too-deep subtree of a merge target, so merging stays
   * linear instead of rebuilding the set once per too-deep node.
   */
  const parseSubheadings = (
    input: unknown,
    depth: number,
    parentLabel: string,
    parentSubjectIds: string[],
    mergedSeen?: Set<string>,
  ): PortableCollectionSubheadingV1[] => {
    if (input === undefined) return [];
    if (!Array.isArray(input)) throw new Error(`${parentLabel} subheadings must be a list.`);
    if (depth > MAX_PORTABLE_DEPTH) throw new Error(`Portable collection subheadings exceed ${MAX_PORTABLE_DEPTH} levels.`);
    subheadingCount += input.length;
    if (subheadingCount > MAX_PORTABLE_COLLECTIONS) throw new Error("The portable collections component has too many subheadings.");
    if (depth > MAX_LAYOUT_DEPTH) {
      const seen = mergedSeen ?? new Set(parentSubjectIds);
      for (const [index, rawSub] of input.entries()) {
        const subheading = asUnknownRecord(rawSub);
        const subId = claimStructureId(subheading.id, `${parentLabel} subheading ${index + 1} ID`);
        safeTitle(subheading.title, `${parentLabel} subheading ${index + 1} title`);
        for (const subjectId of parseSubjectIds(subheading.subjectIds, known, `Subheading ${subId} subjects`, budget)) {
          if (seen.has(subjectId)) continue;
          seen.add(subjectId);
          parentSubjectIds.push(subjectId);
        }
        parseSubheadings(subheading.subheadings, depth + 1, `Subheading ${subId}`, parentSubjectIds, seen);
      }
      return [];
    }
    return input.map((rawSub, subIndex) => {
      const subheading = asUnknownRecord(rawSub);
      const subId = claimStructureId(subheading.id, `${parentLabel} subheading ${subIndex + 1} ID`);
      const subjectIds = parseSubjectIds(subheading.subjectIds, known, `Subheading ${subId} subjects`, budget);
      const nested = parseSubheadings(subheading.subheadings, depth + 1, `Subheading ${subId}`, subjectIds);
      return {
        id: subId,
        title: safeTitle(subheading.title, `${parentLabel} subheading ${subIndex + 1} title`),
        collapsed: subheading.collapsed === true,
        subjectIds,
        ...(nested.length > 0 ? { subheadings: nested } : {}),
      };
    });
  };
  const collections: PortableCollectionV1[] = value.collections.map((raw, collectionIndex) => {
    const collection = asUnknownRecord(raw);
    const id = claimStructureId(collection.id, `Collection ${collectionIndex + 1} ID`);
    if (!Array.isArray(collection.subheadings)) throw new Error(`Collection ${id} subheadings must be a list.`);
    const subjectIds = parseSubjectIds(collection.subjectIds, known, `Collection ${id} subjects`, budget);
    return {
      id,
      title: safeTitle(collection.title, `Collection ${collectionIndex + 1} title`),
      collapsed: collection.collapsed === true,
      subjectIds,
      subheadings: parseSubheadings(collection.subheadings, 2, `Collection ${id}`, subjectIds),
    };
  });
  return { version: 1, collections };
}

function parseSavedViews(input: unknown, packageVersion: PortableExportVersion): PortableSavedViewsV1 {
  const value = asUnknownRecord(input);
  if (value.version !== 1 || !Array.isArray(value.views) || value.views.length > MAX_PORTABLE_COLLECTIONS) throw new Error("Unsupported saved views component.");
  const ids = new Set<string>();
  const views: SavedView[] = value.views.map((raw, index) => {
    const view = asUnknownRecord(raw);
    const id = safeId(view.id, `Saved view ${index + 1} ID`);
    if (ids.has(id)) throw new Error(`Duplicate saved view ID: ${id}`);
    ids.add(id);
    const legacyLibraryId = packageVersion < LIBRARY_IDENTITY_PORTABLE_EXPORT_VERSION
      ? view.tab === "procedures" ? BUILTIN_LIBRARY_IDS.procedure
        : view.tab === "medications" ? BUILTIN_LIBRARY_IDS.medication
          : view.tab === "syndromes" ? BUILTIN_LIBRARY_IDS.syndrome
            : null
      : null;
    const tab = legacyLibraryId ? libraryTabId(legacyLibraryId) : view.tab;
    if (!isMainTab(tab)) throw new Error(`Saved view ${id} has an unsupported tab.`);
    const query = typeof view.query === "string" ? view.query : "";
    if (query.length > MAX_SAVED_VIEW_QUERY_LENGTH) throw new Error(`Saved view ${id} query is too long.`);
    return { id, name: safeTitle(view.name, `Saved view ${index + 1} name`), tab, query };
  });
  return { version: 1, views };
}

export function parsePortableExport(input: unknown): PortableExportV1 {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("The selected file is not a Command Center portable export.");
  const value = input as Record<string, unknown>;
  if (value.kind !== PORTABLE_EXPORT_KIND
    || (value.version !== LEGACY_PORTABLE_EXPORT_VERSION
      && value.version !== CATALOG_PORTABLE_EXPORT_VERSION
      && value.version !== LIBRARY_LAYOUT_PORTABLE_EXPORT_VERSION
      && value.version !== LIBRARY_IDENTITY_PORTABLE_EXPORT_VERSION
      && value.version !== PORTABLE_EXPORT_VERSION)) {
    throw new Error("Unsupported Command Center portable export.");
  }
  const packageVersion = value.version;
  const rawComponents = asUnknownRecord(value.components);
  const components: PortableExportV1["components"] = {};
  const referenceBudget: PortableReferenceBudget = { total: 0 };
  if (rawComponents.workspace !== undefined) components.workspace = parseWorkspaceConfig(rawComponents.workspace);
  if (rawComponents.index !== undefined) components.index = parsePortableIndex(rawComponents.index, packageVersion, referenceBudget);
  const knownSubjects = new Set(components.index?.subjects.map((subject) => subject.id) ?? []);
  if (rawComponents.collections !== undefined) {
    if (!components.index) throw new Error("Portable collections require an index subject catalog.");
    components.collections = parsePortableCollections(rawComponents.collections, knownSubjects, referenceBudget);
  }
  if (rawComponents.study !== undefined) {
    if (!components.index) throw new Error("Portable study organization requires an index subject catalog.");
    const study = asUnknownRecord(rawComponents.study);
    if (study.version !== 1) throw new Error("Unsupported portable study component.");
    components.study = {
      version: 1,
      pinnedSubjectIds: parseSubjectIds(study.pinnedSubjectIds, knownSubjects, "Pinned subjects", referenceBudget),
      nextSubjectIds: parseSubjectIds(study.nextSubjectIds, knownSubjects, "Next-list subjects", referenceBudget),
    };
  }
  if (rawComponents.savedViews !== undefined) components.savedViews = parseSavedViews(rawComponents.savedViews, packageVersion);
  if (packageDeclaresCatalogs(packageVersion) && components.index) {
    const sections = components.index.includedSections;
    if (!sections) throw new Error(`Portable version ${packageVersion} subject catalogs are missing includedSections.`);
    const referenced = new Set<string>();
    for (const collection of components.collections?.collections ?? []) {
      forEachPortableCollectionNode(collection, (node) => node.subjectIds.forEach((id) => referenced.add(id)));
    }
    components.study?.pinnedSubjectIds.forEach((id) => referenced.add(id));
    components.study?.nextSubjectIds.forEach((id) => referenced.add(id));
    for (const subject of components.index.subjects) {
      const explicitlyIncluded = (subject.indexed && sections.index)
        || libraryIdIsSelected(subjectLibraryId(subject), {
          ...EMPTY_PORTABLE_SELECTION,
          libraryIds: sections.libraryIds,
        });
      if (!explicitlyIncluded && !referenced.has(subject.id)) {
        throw new Error(`Portable subject ${subject.id} belongs to an undeclared catalog and is not referenced by an included section.`);
      }
    }
  }
  if (packageVersion >= LIBRARY_IDENTITY_PORTABLE_EXPORT_VERSION) {
    const knownLibraries = new Set(components.index?.libraries?.map((library) => library.id) ?? []);
    const referencedLibraryIds = new Set<string>();
    const defaultLibraryId = components.workspace ? libraryIdFromTab(components.workspace.settings.defaultTab) : null;
    if (defaultLibraryId) referencedLibraryIds.add(defaultLibraryId);
    Object.keys(components.workspace?.settings.libraryNoteProfiles ?? {}).forEach((libraryId) => {
      referencedLibraryIds.add(libraryId);
    });
    for (const view of components.savedViews?.views ?? []) {
      const libraryId = libraryIdFromTab(view.tab);
      if (libraryId) referencedLibraryIds.add(libraryId);
    }
    for (const libraryId of referencedLibraryIds) {
      if (!knownLibraries.has(libraryId)) {
        throw new Error(`Portable component references library ${libraryId} without a definition.`);
      }
    }
  }
  if (rawComponents.recovery !== undefined) components.recovery = parsePersonalBackup(rawComponents.recovery);
  if (Object.keys(components).length === 0) throw new Error("This portable export contains no supported components.");
  const rawSourceWorkspace = typeof value.sourceWorkspace === "string" ? value.sourceWorkspace : "";
  const sourceWorkspace = rawSourceWorkspace.trim()
    ? safeTitle(rawSourceWorkspace, "Source workspace name")
    : "";
  return {
    kind: PORTABLE_EXPORT_KIND,
    version: packageVersion,
    exportedAt: typeof value.exportedAt === "string" ? value.exportedAt : "",
    sourceWorkspace,
    components,
  };
}

export function parseAnyCommandCenterExport(input: unknown): PortableExportV1 {
  const value = asUnknownRecord(input);
  if (value.kind === PORTABLE_EXPORT_KIND) return parsePortableExport(input);
  const exportedAt = typeof value.exportedAt === "string" ? value.exportedAt : "";
  if (value.kind === "knowledge-base-command-center-workspace") {
    const workspace = parseWorkspaceConfig(input);
    return { kind: PORTABLE_EXPORT_KIND, version: 1, exportedAt, sourceWorkspace: workspace.settings.workspaceName, components: { workspace } };
  }
  if (value.kind === "ent-vault-command-center-personal-backup") {
    const recovery = parsePersonalBackup(input);
    return { kind: PORTABLE_EXPORT_KIND, version: 1, exportedAt, sourceWorkspace: "", components: { recovery } };
  }
  throw new Error("The selected JSON is not a supported Command Center export or backup.");
}

export function selectionAvailableForExport(value: PortableExportV1): PortableExportSelection {
  const index = value.components.index;
  const sections = packageDeclaresCatalogs(value.version) ? index?.includedSections : undefined;
  return normalizePortableSelection({
    workspace: Boolean(value.components.workspace),
    // Version 1 never declared full clinical-library catalogs; any non-topic
    // subjects in it are dependencies of Collections or Study state.
    index: Boolean(index) && (sections ? sections.index : index?.includeIndex !== false),
    libraryIds: sections?.libraryIds ?? [],
    procedures: false,
    medications: false,
    syndromes: false,
    collections: Boolean(value.components.collections),
    study: Boolean(value.components.study),
    savedViews: Boolean(value.components.savedViews),
    recovery: Boolean(value.components.recovery),
  });
}

export function summarizePortableExport(
  value: PortableExportV1,
  requestedSelection?: PortableExportSelection,
): PortableExportSummary {
  const index = requestedSelection
    ? portableIndexForSelection(value, normalizePortableSelection(requestedSelection))
    : value.components.index;
  const libraryDefinitions = new Map((index?.libraries ?? []).map((library) => [library.id, library]));
  const libraryIds = index?.includedSections?.libraryIds
    ?? [...new Set(index?.subjects.map((subject) => subjectLibraryId(subject)).filter((id): id is string => Boolean(id)) ?? [])];
  const libraries = libraryIds.map((id) => {
    const layout = index?.libraryLayouts?.[id] ?? [];
    return {
      id,
      name: libraryDefinitions.get(id)?.name ?? id,
      subjects: index?.subjects.filter((subject) => subjectLibraryId(subject) === id).length ?? 0,
      headings: countLayoutStructures(layout),
    };
  });
  return {
    groups: index?.indexGroupIds?.length ?? (index?.includeIndex === false ? 0 : index?.groups.length ?? 0),
    subjects: index?.subjects.length ?? 0,
    indexSubjects: index?.subjects.filter((subject) => subject.recordKind === "topic" && subject.indexed).length ?? 0,
    procedures: index?.subjects.filter((subject) => subjectLibraryId(subject) === BUILTIN_LIBRARY_IDS.procedure).length ?? 0,
    medications: index?.subjects.filter((subject) => subjectLibraryId(subject) === BUILTIN_LIBRARY_IDS.medication).length ?? 0,
    syndromes: index?.subjects.filter((subject) => subjectLibraryId(subject) === BUILTIN_LIBRARY_IDS.syndrome).length ?? 0,
    libraries,
    placeholders: index?.subjects.length ?? 0,
    collections: value.components.collections?.collections.length ?? 0,
    pinned: value.components.study?.pinnedSubjectIds.length ?? 0,
    next: value.components.study?.nextSubjectIds.length ?? 0,
    views: value.components.savedViews?.views.length ?? 0,
    hasRecovery: Boolean(value.components.recovery),
  };
}

function mergeOrdered(existing: string[], incoming: string[]): string[] {
  const incomingSet = new Set(incoming);
  return unique([...incoming, ...existing.filter((value) => !incomingSet.has(value))]);
}

function translateLibraryLayout(layout: LayoutHeading[], subjectIdMap: Map<string, string>): LayoutHeading[] {
  const translate = (ids: string[]): string[] => unique(ids.map((id) => subjectIdMap.get(id) || id));
  const translateSubheading = (subheading: LayoutSubheading): LayoutSubheading => {
    const translated: LayoutSubheading = { ...subheading, subjects: translate(subheading.subjects) };
    if (subheading.subheadings) translated.subheadings = subheading.subheadings.map(translateSubheading);
    return translated;
  };
  return layout.map((heading) => ({
    ...heading,
    subjects: translate(heading.subjects),
    subheadings: heading.subheadings.map(translateSubheading),
  }));
}

/**
 * A destination layout node addressed by identity. Cleaned layouts guarantee
 * globally unique node IDs, so the resolved parent ID pins the node's full
 * ancestor path: two nodes share a parent ID exactly when they share every
 * ancestor. Top-level headings carry a null parent.
 */
interface CollectionStructureOwner {
  parentId: string | null;
  node: LayoutHeading | LayoutSubheading;
}

function mergeCollectionsLayout(existing: LayoutHeading[], incoming: LayoutHeading[]): LayoutHeading[] {
  const merged = cloneCollections(existing);
  const owners = new Map<string, CollectionStructureOwner>();
  const availableHeadingIdsByTitle = new Map<string, Set<string>>();
  const registerOwners = (nodes: readonly (LayoutHeading | LayoutSubheading)[], parentId: string | null): void => {
    for (const node of nodes) {
      owners.set(node.id, { parentId, node });
      registerOwners(childSubheadings(node), node.id);
    }
  };
  registerOwners(merged, null);
  for (const heading of merged) {
    const headingTitle = normalizedNameKey(heading.title);
    const headingIds = availableHeadingIdsByTitle.get(headingTitle) ?? new Set<string>();
    headingIds.add(heading.id);
    availableHeadingIdsByTitle.set(headingTitle, headingIds);
  }
  const reservedIncomingIds = new Set<string>();
  forEachLayoutNode(incoming, (node) => reservedIncomingIds.add(node.id));
  const claimedIds = new Set<string>();
  const claimId = (id: string): void => {
    if (claimedIds.has(id)) return;
    claimedIds.add(id);
    const owner = owners.get(id);
    if (!owner) return;
    if (owner.parentId === null) {
      availableHeadingIdsByTitle.get(normalizedNameKey(owner.node.title))?.delete(id);
    }
  };
  // Compatibility is the same normalized title under the same resolved parent
  // node and therefore, through globally unique layout IDs, under the same
  // full ancestor path.
  const compatibleNode = (owner: CollectionStructureOwner, title: string, parentId: string | null): boolean => (
    owner.parentId === parentId && normalizedNameKey(owner.node.title) === normalizedNameKey(title)
  );
  const deterministicFork = (
    seed: string,
    compatible: (owner: CollectionStructureOwner) => boolean,
  ): { owner?: CollectionStructureOwner; id?: string } => {
    const base = `collection-import-${fingerprintText(seed)}`;
    for (let attempt = 1; ; attempt += 1) {
      const id = attempt === 1 ? base : `${base}-${attempt}`;
      // A generated fork must not consume (or weakly match through) the stable
      // ID of another incoming node that has not been processed yet.
      if (reservedIncomingIds.has(id)) continue;
      const owner = owners.get(id);
      if (owner) {
        if (!claimedIds.has(id) && compatible(owner)) return { owner };
        continue;
      }
      return { id };
    }
  };
  /**
   * Fork seeds are keyed by the node's full incoming ancestor path. For nodes
   * at depth one and two the seeds are byte-identical to the historical flat
   * seeds, so identities forked by earlier builds remain stable on reimport.
   */
  const forkSeed = (incomingAncestorIds: readonly string[], node: LayoutHeading | LayoutSubheading): string => (
    incomingAncestorIds.length === 0
      ? `heading\u0000${node.id}\u0000${normalizedNameKey(node.title)}`
      : `subheading\u0000${incomingAncestorIds.join("\u0000")}\u0000${node.id}\u0000${normalizedNameKey(node.title)}`
  );

  const mergeLevel = (
    incomingNodes: readonly (LayoutHeading | LayoutSubheading)[],
    incomingAncestorIds: readonly string[],
    targetParent: LayoutHeading | LayoutSubheading | null,
  ): void => {
    const parentId = targetParent?.id ?? null;

    // Reserve every safe exact match at this level before weaker matching.
    // Otherwise an earlier same-title sibling can consume the destination node
    // that a later incoming node addresses by its stable ID.
    const exactTargets = new Map<string, LayoutHeading | LayoutSubheading>();
    for (const node of incomingNodes) {
      const owner = owners.get(node.id);
      if (!owner || claimedIds.has(node.id) || !compatibleNode(owner, node.title, parentId)) continue;
      exactTargets.set(node.id, owner.node);
      claimId(node.id);
    }

    const forkTargets = new Map<string, LayoutHeading | LayoutSubheading>();
    for (const node of incomingNodes) {
      if (exactTargets.has(node.id)) continue;
      const fork = deterministicFork(
        forkSeed(incomingAncestorIds, node),
        (owner) => compatibleNode(owner, node.title, parentId),
      );
      if (!fork.owner) continue;
      forkTargets.set(node.id, fork.owner.node);
      claimId(fork.owner.node.id);
    }

    for (const incomingNode of incomingNodes) {
      let target = exactTargets.get(incomingNode.id) ?? forkTargets.get(incomingNode.id);
      let fork: { owner?: CollectionStructureOwner; id?: string } | undefined;
      if (!target) {
        fork = deterministicFork(
          forkSeed(incomingAncestorIds, incomingNode),
          (owner) => compatibleNode(owner, incomingNode.title, parentId),
        );
        if (fork.owner) target = fork.owner.node;
      }
      if (!target && parentId === null) {
        // Weak title matching remains a top-level-only fallback to exactly one
        // unambiguous unclaimed pre-existing destination heading.
        const candidateIds = availableHeadingIdsByTitle.get(normalizedNameKey(incomingNode.title));
        if (candidateIds?.size === 1) {
          const candidateId = candidateIds.values().next().value as string;
          const owner = owners.get(candidateId);
          if (owner && owner.parentId === null) target = owner.node;
        }
      }
      if (!target) {
        const preferredIsFree = !owners.has(incomingNode.id);
        const id = preferredIsFree
          ? incomingNode.id
          : fork?.id ?? deterministicFork(
            forkSeed(incomingAncestorIds, incomingNode),
            (owner) => compatibleNode(owner, incomingNode.title, parentId),
          ).id;
        if (!id) {
          throw new Error(`A portable collection ${parentId === null ? "heading" : "subheading"} identity could not be allocated safely.`);
        }
        if (targetParent === null) {
          const created: LayoutHeading = {
            id,
            title: incomingNode.title,
            collapsed: incomingNode.collapsed,
            subjects: [],
            subheadings: [],
          };
          merged.push(created);
          target = created;
        } else {
          // Nested targets stay canonical: the parent's child key materializes
          // only once an actual child node is appended.
          const created: LayoutSubheading = {
            id,
            title: incomingNode.title,
            collapsed: incomingNode.collapsed,
            subjects: [],
          };
          (targetParent.subheadings ??= []).push(created);
          target = created;
        }
        owners.set(id, { parentId, node: target });
      }
      claimId(target.id);
      target.title = incomingNode.title;
      target.subjects = unique([...target.subjects, ...incomingNode.subjects]);
      mergeLevel(childSubheadings(incomingNode), [...incomingAncestorIds, incomingNode.id], target);
    }
  };
  mergeLevel(incoming, [], null);
  return merged;
}

function mergeLibraryLayout(existing: LayoutHeading[], incoming: LayoutHeading[], libraryId: string): LayoutHeading[] {
  const incomingSubjectIds = new Set<string>();
  forEachLayoutNode(incoming, (node) => node.subjects.forEach((id) => incomingSubjectIds.add(id)));
  const withoutIncomingSubjects = (subheading: LayoutSubheading): LayoutSubheading => {
    const stripped: LayoutSubheading = {
      ...subheading,
      subjects: subheading.subjects.filter((id) => !incomingSubjectIds.has(id)),
    };
    if (subheading.subheadings) stripped.subheadings = subheading.subheadings.map(withoutIncomingSubjects);
    return stripped;
  };
  const merged = cloneCollections(existing).map((heading) => ({
    ...heading,
    subjects: heading.subjects.filter((id) => !incomingSubjectIds.has(id)),
    subheadings: heading.subheadings.map(withoutIncomingSubjects),
  }));
  const usedStructureIds = new Set<string>();
  forEachLayoutNode(merged, (node) => usedStructureIds.add(node.id));
  const reservedIncomingIds = new Set<string>();
  forEachLayoutNode(incoming, (node) => reservedIncomingIds.add(node.id));
  /**
   * Reminted identities mirror the deterministic collection fork scheme:
   * layout node IDs are semantic state, so two devices importing the same
   * package must allocate identical forks or their otherwise-identical
   * stores would diverge into a spurious sync conflict. The seed is the
   * node's full incoming ancestor path under a library discriminator, and a
   * generated fork must not consume the stable ID of another incoming node.
   */
  const allocateStructureId = (
    incomingAncestorIds: readonly string[],
    node: LayoutHeading | LayoutSubheading,
  ): string => {
    if (!usedStructureIds.has(node.id)) {
      usedStructureIds.add(node.id);
      return node.id;
    }
    const seed = incomingAncestorIds.length === 0
      ? `library-heading\u0000${libraryId}\u0000${node.id}\u0000${normalizedNameKey(node.title)}`
      : `library-subheading\u0000${libraryId}\u0000${incomingAncestorIds.join("\u0000")}\u0000${node.id}\u0000${normalizedNameKey(node.title)}`;
    const base = `library-import-${fingerprintText(seed)}`;
    for (let attempt = 1; ; attempt += 1) {
      const id = attempt === 1 ? base : `${base}-${attempt}`;
      if (usedStructureIds.has(id) || reservedIncomingIds.has(id)) continue;
      usedStructureIds.add(id);
      return id;
    }
  };
  // Stable IDs distinguish intentionally repeated labels. A title fallback is
  // only a best-effort match to one pre-existing destination node under the
  // same resolved ancestor path; it must never consume a node created (or
  // already claimed) by another incoming sibling, otherwise two valid
  // same-title nodes collapse into one.
  const mergeChildren = (
    incomingChildren: readonly LayoutSubheading[],
    incomingAncestorIds: readonly string[],
    targetParent: LayoutHeading | LayoutSubheading,
  ): void => {
    if (incomingChildren.length === 0) return;
    const children = (targetParent.subheadings ??= []);
    const byId = new Map(children.map((child) => [child.id, child]));
    const byTitle = new Map<string, LayoutSubheading[]>();
    for (const child of children) {
      const candidates = byTitle.get(normalizedNameKey(child.title)) ?? [];
      candidates.push(child);
      byTitle.set(normalizedNameKey(child.title), candidates);
    }
    const claimedIds = new Set<string>();
    // Reserve every exact stable-ID match at this level before weaker title
    // matching, mirroring the collections merge: otherwise an earlier
    // same-title sibling's title fallback consumes the destination node that
    // a later incoming sibling addresses by its stable ID.
    const exactTargets = new Map<string, LayoutSubheading>();
    for (const incomingChild of incomingChildren) {
      const candidate = byId.get(incomingChild.id);
      if (!candidate || claimedIds.has(candidate.id)
        || normalizedNameKey(candidate.title) !== normalizedNameKey(incomingChild.title)) continue;
      exactTargets.set(incomingChild.id, candidate);
      claimedIds.add(candidate.id);
    }
    for (const incomingChild of incomingChildren) {
      let target = exactTargets.get(incomingChild.id);
      if (!target) {
        const candidates = (byTitle.get(normalizedNameKey(incomingChild.title)) ?? [])
          .filter((candidate) => !claimedIds.has(candidate.id));
        if (candidates.length === 1) target = candidates[0];
      }
      if (!target) {
        const created: LayoutSubheading = {
          id: allocateStructureId(incomingAncestorIds, incomingChild),
          title: incomingChild.title,
          collapsed: incomingChild.collapsed,
          subjects: [],
        };
        children.push(created);
        byId.set(created.id, created);
        target = created;
      }
      claimedIds.add(target.id);
      target.title = incomingChild.title;
      target.subjects = unique([...target.subjects, ...incomingChild.subjects]);
      mergeChildren(childSubheadings(incomingChild), [...incomingAncestorIds, incomingChild.id], target);
    }
  };
  const byId = new Map(merged.map((heading) => [heading.id, heading]));
  const titleCandidates = new Map<string, LayoutHeading[]>();
  for (const heading of merged) {
    const candidates = titleCandidates.get(normalizedNameKey(heading.title)) ?? [];
    candidates.push(heading);
    titleCandidates.set(normalizedNameKey(heading.title), candidates);
  }
  const claimedHeadingIds = new Set<string>();
  // The same reservation applies at the top level: exact stable-ID matches
  // claim their destination headings before any title-based matching.
  const exactHeadingTargets = new Map<string, LayoutHeading>();
  for (const incomingHeading of incoming) {
    const candidate = byId.get(incomingHeading.id);
    if (!candidate || claimedHeadingIds.has(candidate.id)
      || normalizedNameKey(candidate.title) !== normalizedNameKey(incomingHeading.title)) continue;
    exactHeadingTargets.set(incomingHeading.id, candidate);
    claimedHeadingIds.add(candidate.id);
  }
  for (const incomingHeading of incoming) {
    let target = exactHeadingTargets.get(incomingHeading.id);
    if (!target) {
      const candidates = (titleCandidates.get(normalizedNameKey(incomingHeading.title)) ?? [])
        .filter((candidate) => !claimedHeadingIds.has(candidate.id));
      if (candidates.length === 1) target = candidates[0];
    }
    if (!target) {
      target = {
        id: allocateStructureId([], incomingHeading),
        title: incomingHeading.title,
        collapsed: incomingHeading.collapsed,
        subjects: [],
        subheadings: [],
      };
      merged.push(target);
      byId.set(target.id, target);
    }
    claimedHeadingIds.add(target.id);
    target.title = incomingHeading.title;
    target.subjects = unique([...target.subjects, ...incomingHeading.subjects]);
    mergeChildren(childSubheadings(incomingHeading), [incomingHeading.id], target);
  }
  return merged;
}

function navigationLibraryIdsForSelection(
  value: PortableExportV1,
  selection: NormalizedPortableExportSelection,
): Set<string> {
  const libraryIds = new Set<string>();
  if (selection.workspace && value.components.workspace) {
    const libraryId = libraryIdFromTab(value.components.workspace.settings.defaultTab);
    if (libraryId) libraryIds.add(libraryId);
    Object.keys(value.components.workspace.settings.libraryNoteProfiles).forEach((profileLibraryId) => {
      libraryIds.add(profileLibraryId);
    });
  }
  if (selection.savedViews) {
    for (const view of value.components.savedViews?.views ?? []) {
      const libraryId = libraryIdFromTab(view.tab);
      if (libraryId) libraryIds.add(libraryId);
    }
  }
  return libraryIds;
}

function portableIndexForSelection(
  value: PortableExportV1,
  selection: NormalizedPortableExportSelection,
): PortableIndexV1 | undefined {
  const index = value.components.index;
  if (!index) return undefined;

  const descriptorLibraryIds = navigationLibraryIdsForSelection(value, selection);
  if (!selectionNeedsSubjectCatalog(selection) && descriptorLibraryIds.size === 0) return undefined;

  const referencedIds = new Set<string>();
  if (selection.collections) {
    for (const collection of value.components.collections?.collections ?? []) {
      forEachPortableCollectionNode(collection, (node) => node.subjectIds.forEach((id) => referencedIds.add(id)));
    }
  }
  if (selection.study) {
    value.components.study?.pinnedSubjectIds.forEach((id) => referencedIds.add(id));
    value.components.study?.nextSubjectIds.forEach((id) => referencedIds.add(id));
  }

  const subjectById = new Map(index.subjects.map((subject) => [subject.id, subject]));
  const legacyIndexSubject = (subject: PortableSubjectDefinition): boolean => (
    index.version < PORTABLE_EXPORT_VERSION && subject.recordKind === "topic" && !subjectLibraryId(subject)
  );
  const includedIds = new Set(index.subjects
    .filter((subject) => (selection.index && (subject.indexed || legacyIndexSubject(subject)))
      || libraryIdIsSelected(subjectLibraryId(subject), selection)
      || referencedIds.has(subject.id))
    .map((subject) => subject.id));
  if (selection.index) {
    const ancestorStack = [...includedIds];
    while (ancestorStack.length > 0) {
      const parentId = subjectById.get(ancestorStack.pop() ?? "")?.parentId;
      if (!parentId || includedIds.has(parentId)) continue;
      includedIds.add(parentId);
      ancestorStack.push(parentId);
    }
  }

  const subjects = index.subjects
    .filter((subject) => includedIds.has(subject.id))
    .map((subject) => ({
      ...subject,
      parentId: selection.index && (subject.indexed || legacyIndexSubject(subject)) ? subject.parentId : null,
      indexed: selection.index && subject.indexed,
      libraryId: subject.indexed ? null : subjectLibraryId(subject),
    }));
  const neededLibraryIds = new Set(selection.libraryIds);
  descriptorLibraryIds.forEach((id) => neededLibraryIds.add(id));
  for (const subject of subjects) {
    const libraryId = subjectLibraryId(subject);
    if (libraryId) neededLibraryIds.add(libraryId);
  }
  const libraries = (index.libraries ?? [])
    .filter((library) => neededLibraryIds.has(library.id))
    .map((library) => ({ ...library }));
  const subjectGroupIds = new Set(subjects.map((subject) => subject.groupId));
  const sourceIndexGroupIds = selection.index
    ? new Set(index.indexGroupIds ?? (index.includeIndex === false ? [] : index.groups.map((group) => group.id)))
    : new Set<string>();
  const includedGroupIds = new Set([...subjectGroupIds, ...sourceIndexGroupIds]);
  const groups = index.groups.filter((group) => includedGroupIds.has(group.id));
  const groupIds = new Set(groups.map((group) => group.id));
  const selectedIndexGroupIds = [...sourceIndexGroupIds].filter((id) => groupIds.has(id));

  return {
    version: index.version,
    groups,
    subjects,
    libraries,
    libraryLayouts: portableLibraryLayoutsForSelection(
      index.libraryLayouts ?? cleanLibraryLayouts(undefined, index.groups, index.subjects),
      selection,
      includedIds,
    ),
    ...(packageDeclaresCatalogs(index.version) ? { includedSections: catalogSelectionFromExport(selection) } : {}),
    includeIndex: selection.index,
    indexGroupIds: selectedIndexGroupIds,
    ...(index.collapsedGroupIds ? {
      collapsedGroupIds: index.collapsedGroupIds.filter((id) => sourceIndexGroupIds.has(id)),
    } : {}),
    ...(index.collapsedSubjectIds ? {
      collapsedSubjectIds: index.collapsedSubjectIds.filter((id) => includedIds.has(id) && subjectById.get(id)?.indexed),
    } : {}),
  };
}

function assertEntPortableIndexSubjectsAreTopics(
  incomingIndex: PortableIndexV1 | undefined,
  destinationMode: WorkspaceMode,
): void {
  if (destinationMode !== "ent-clinical" || !incomingIndex) return;
  const incompatible = incomingIndex.subjects.filter((subject) => subject.indexed && subject.recordKind !== "topic");
  if (incompatible.length === 0) return;
  const examples = incompatible.slice(0, 3).map((subject) => `“${subject.title}” (${subject.recordKind})`).join(", ");
  const more = incompatible.length > 3 ? ` and ${incompatible.length - 3} more` : "";
  throw new Error(`The ENT knowledge index accepts topic subjects only. This package would index ${examples}${more}. No portable data was imported.`);
}

/** Destination-aware preflight; parsing remains intentionally preset-neutral. */
export function assertPortableImportDestinationCompatible(
  value: PortableExportV1,
  requestedSelection: PortableExportSelection,
  destinationMode: WorkspaceMode,
): void {
  const selection = normalizePortableSelection(requestedSelection);
  assertEntPortableIndexSubjectsAreTopics(portableIndexForSelection(value, selection), destinationMode);
}

function applyRecovery(data: PluginData, backup: PersonalBackup): void {
  data.collections = cloneCollections(backup.collections);
  data.pinnedPaths = [...backup.pinnedPaths];
  data.nextStudyPaths = [...backup.nextStudyPaths];
  data.savedViews = backup.savedViews.map((view) => ({ ...view }));
  data.curriculumVisual = cloneCurriculumVisual(backup.curriculumVisual);
  data.manualIndexPaths = [...backup.manualIndexPaths];
  data.excludedIndexPaths = [...backup.excludedIndexPaths];
  data.indexGroupByPath = { ...backup.indexGroupByPath };
  data.displayNameByPath = { ...backup.displayNameByPath };
  data.indexGroupAliases = { ...backup.indexGroupAliases };
  data.indexGroupOrder = [...backup.indexGroupOrder];
  data.layoutSnapshots = backup.layoutSnapshots.map((snapshot) => structuredClone(snapshot));
  data.portableIndex = structuredClone(backup.portableIndex);
}

/** Applies already-validated components to plugin-owned state. It never touches Markdown files. */
export function applyPortableExport(
  data: PluginData,
  value: PortableExportV1,
  requestedSelection: PortableExportSelection,
  mode: PortableImportMode,
  currentVaultId = "",
  recoveryPathExists?: (path: string) => boolean,
  currentBaseId = "",
  currentBaseName = "",
  allowCrossBaseRecovery = false,
): PortableImportResult {
  const selection = normalizePortableSelection(requestedSelection);
  const available = normalizePortableSelection(selectionAvailableForExport(value));
  const staticKeys = ["workspace", "index", "collections", "study", "savedViews", "recovery"] as const;
  for (const key of staticKeys) {
    if (selection[key] && !available[key]) throw new Error(`The export does not contain the selected ${key} component.`);
  }
  const availableLibraryIds = new Set(available.libraryIds);
  for (const libraryId of selection.libraryIds) {
    if (availableLibraryIds.has(libraryId)) continue;
    const legacyLabel = libraryId === BUILTIN_LIBRARY_IDS.procedure ? "procedures"
      : libraryId === BUILTIN_LIBRARY_IDS.medication ? "medications"
        : libraryId === BUILTIN_LIBRARY_IDS.syndrome ? "syndromes"
          : `library ${libraryId}`;
    throw new Error(`The export does not contain the selected ${legacyLabel} component.`);
  }
  if (selection.recovery) {
    const otherSelected = selection.workspace
      || selection.index
      || selection.libraryIds.length > 0
      || selection.collections
      || selection.study
      || selection.savedViews;
    if (otherSelected) throw new Error("Same-vault recovery must be restored by itself.");
    if (mode !== "replace") throw new Error("Same-vault recovery is a restore operation, not a merge.");
    if (value.components.recovery) {
      assertPersonalBackupMatchesVault(
        value.components.recovery,
        currentVaultId,
        recoveryPathExists,
        currentBaseId,
        currentBaseName,
        data.settings.workspaceMode,
        allowCrossBaseRecovery,
      );
    }
  }
  const result: PortableImportResult = {
    addedSubjects: 0,
    updatedSubjects: 0,
    matchedSubjects: 0,
    unresolvedSubjects: 0,
    importedCollections: 0,
    importedViews: 0,
  };

  const incomingWorkspace = selection.workspace ? value.components.workspace : undefined;
  if (incomingWorkspace && incomingWorkspace.settings.workspaceMode !== data.settings.workspaceMode) {
    throw new Error(`This package uses the ${incomingWorkspace.settings.workspaceMode === "ent-clinical" ? "ENT clinical" : "Generic"} preset. Create or switch to a matching knowledge base before importing Workspace settings.`);
  }

  const incomingIndex = portableIndexForSelection(value, selection);
  assertEntPortableIndexSubjectsAreTopics(incomingIndex, data.settings.workspaceMode);
  const state = data.portableIndex;
  const existingLibraries = Array.isArray(state.libraries)
    ? state.libraries
    : legacyPortableLibraries(state.subjects, [], false).map((library) => ({ ...library, archivedAt: null }));
  const existingLibraryIds = new Set(existingLibraries.map((library) => library.id));
  const incomingLibraries = incomingIndex?.libraries ?? [];
  const navigationLibraryIds = navigationLibraryIdsForSelection(value, selection);
  // Versions 1–3 predate portable library descriptors. Their only stable
  // navigation targets were the three built-in IDs, which can be recreated
  // without guessing a user-defined library's identity or semantics.
  const legacyNavigationLibraries = value.version < PORTABLE_EXPORT_VERSION
    ? BUILTIN_LIBRARY_DEFINITIONS.filter((library) => navigationLibraryIds.has(library.id))
    : [];
  const missingLibraryIds = new Set([
    ...incomingLibraries.map((library) => library.id),
    ...legacyNavigationLibraries.map((library) => library.id),
  ].filter((libraryId) => !existingLibraryIds.has(libraryId)));
  if (existingLibraries.length + missingLibraryIds.size > MAX_LIBRARIES) {
    throw new Error(`Importing these catalogs would exceed the ${MAX_LIBRARIES}-library limit.`);
  }

  if (selection.recovery && value.components.recovery) applyRecovery(data, value.components.recovery);
  if (incomingIndex || legacyNavigationLibraries.length > 0) {
    state.libraries = existingLibraries;
    state.libraryLayouts ??= cleanLibraryLayouts(undefined, state.groups, state.subjects, state.libraries);
    const localLibraryById = new Map(state.libraries.map((library) => [library.id, library]));
    for (const incoming of incomingLibraries) {
      const existing = localLibraryById.get(incoming.id);
      const authoritative = selection.libraryIds.includes(incoming.id);
      if (existing) {
        if (authoritative) {
          existing.name = incoming.name;
          existing.singularName = incoming.singularName;
          existing.icon = incoming.icon;
          existing.order = incoming.order;
          existing.archivedAt = null;
        }
        continue;
      }
      const created: LibraryDefinition = { ...incoming, archivedAt: null };
      state.libraries.push(created);
      state.libraryLayouts[created.id] ??= [];
      localLibraryById.set(created.id, created);
    }
    for (const legacyDependency of legacyNavigationLibraries) {
      // A local archive decision is authoritative. Leave it archived and let
      // the navigation sanitizer below remove the unusable imported target.
      if (localLibraryById.has(legacyDependency.id)) continue;
      const created: LibraryDefinition = { ...legacyDependency, archivedAt: null };
      state.libraries.push(created);
      state.libraryLayouts[created.id] ??= [];
      localLibraryById.set(created.id, created);
    }
  }
  const availableNavigationLibraryIds = new Set(state.libraries
    .filter((library) => library.archivedAt === null)
    .map((library) => library.id));
  const navigationTabIsAvailable = (tab: MainTab): boolean => {
    const libraryId = libraryIdFromTab(tab);
    return libraryId === null || availableNavigationLibraryIds.has(libraryId);
  };
  if (incomingWorkspace) {
    // A portable package configures the active base; it must never change the
    // destination base's stable identity. Otherwise importing an ENT package
    // into Research could leave two indistinguishable "ENT" bases in the
    // switcher. The source name remains available as export metadata.
    const destinationWorkspaceName = data.settings.workspaceName;
    const destinationMode = data.settings.workspaceMode;
    const protectedPrimaryFolder = data.settings.primaryFolder;
    const incomingSettings = structuredClone(incomingWorkspace.settings);
    incomingSettings.libraryNoteProfiles = cleanLibraryNoteProfiles(
      incomingSettings.libraryNoteProfiles,
      new Set(state.libraries.map((library) => library.id)),
    );
    if (!navigationTabIsAvailable(incomingSettings.defaultTab)) incomingSettings.defaultTab = "curriculum";
    data.settings = {
      ...incomingSettings,
      workspaceName: destinationWorkspaceName,
      workspaceMode: destinationMode,
      ...(destinationMode === "ent-clinical" ? { primaryFolder: protectedPrimaryFolder } : {}),
      setupComplete: true,
    };
    if (!selection.index) data.indexGroupOrder = [...incomingWorkspace.indexGroupOrder];
  }

  const subjectIdMap = new Map<string, string>();
  if (incomingIndex) {
    state.libraryLayouts ??= cleanLibraryLayouts(undefined, state.groups, state.subjects, state.libraries);
    const oldSubjects = state.subjects.map((subject) => ({ ...subject }));
    const subjectSectionIsSelected = (subject: PortableSubjectDefinition): boolean => (
      (selection.index && (subject.indexed
        || (incomingIndex.version < PORTABLE_EXPORT_VERSION
          && subject.recordKind === "topic"
          && !subjectLibraryId(subject))))
      || libraryIdIsSelected(subjectLibraryId(subject), selection)
    );
    // Empty Index headings have no subject from which to infer ownership.
    // Their stable identity is carried by indexGroupOrder, so a library-only
    // Replace must treat those groups as belonging to the unselected Index.
    const unselectedIndexGroupIds = selection.index
      ? new Set<string>()
      : portableIndexGroupIdsForExport(data);
    const localGroupScopes = portableGroupScopes(oldSubjects);
    for (const groupId of unselectedIndexGroupIds) {
      const scopes = localGroupScopes.get(groupId) ?? new Set<PortableCatalogScope>();
      scopes.add("index");
      localGroupScopes.set(groupId, scopes);
    }
    const incomingGroupScopes = portableGroupScopes(incomingIndex.subjects);
    const groupScopesEqual = (
      left: ReadonlySet<PortableCatalogScope> | undefined,
      right: ReadonlySet<PortableCatalogScope> | undefined,
    ): boolean => {
      if (!left || left.size === 0 || !right || right.size === 0) return true;
      return left.size === right.size && [...left].every((scope) => right.has(scope));
    };
    const groupsUsedByUnselectedSections = new Set(oldSubjects
      .filter((subject) => !subjectSectionIsSelected(subject))
      .map((subject) => subject.groupId));
    for (const groupId of unselectedIndexGroupIds) groupsUsedByUnselectedSections.add(groupId);
    const replacedOldPaths = oldSubjects
      .filter(subjectSectionIsSelected)
      .map((subject) => portableSubjectPath(data, subject.id));
    const oldResolvedPathById = new Map<string, string>();
    const oldIdByPath = new Map<string, string>();
    for (const subject of oldSubjects) {
      oldIdByPath.set(portablePlaceholderPath(subject.id), subject.id);
      const resolved = state.resolvedPathBySubjectId[subject.id];
      if (resolved) {
        oldIdByPath.set(resolved, subject.id);
        oldResolvedPathById.set(subject.id, resolved);
      }
    }
    const protectedLocalIds = new Set<string>();
    const protectPaths = (paths: string[]): void => {
      for (const path of paths) {
        const subjectId = oldIdByPath.get(path);
        if (subjectId) protectedLocalIds.add(subjectId);
      }
    };
    if (!selection.collections) {
      forEachLayoutNode(data.collections, (node) => protectPaths(node.subjects));
    }
    if (!selection.study) {
      protectPaths(data.pinnedPaths);
      protectPaths(data.nextStudyPaths);
    }

    const localGroups = state.groups.map((group) => ({ ...group }));
    const groupById = new Map(localGroups.map((group) => [group.id, group]));
    const groupsByTitle = new Map<string, Set<string>>();
    for (const group of localGroups) {
      const key = normalizedNameKey(group.title);
      const ids = groupsByTitle.get(key) ?? new Set<string>();
      ids.add(group.id);
      groupsByTitle.set(key, ids);
    }
    const claimedGroupIds = new Set<string>();
    const groupIdMap = new Map<string, string>();
    const addGroupTitleCandidate = (group: PortableGroupDefinition): void => {
      const key = normalizedNameKey(group.title);
      const ids = groupsByTitle.get(key) ?? new Set<string>();
      ids.add(group.id);
      groupsByTitle.set(key, ids);
    };
    const uniqueUnclaimedTitleMatch = (
      title: string,
      incomingGroupId: string,
    ): PortableGroupDefinition | undefined => {
      const expectedScopes = incomingGroupScopes.get(incomingGroupId);
      const candidates = [...(groupsByTitle.get(normalizedNameKey(title)) ?? [])]
        .filter((id) => !claimedGroupIds.has(id)
          && groupScopesEqual(localGroupScopes.get(id), expectedScopes));
      return candidates.length === 1 ? groupById.get(candidates[0] ?? "") : undefined;
    };
    const createMappedGroup = (incoming: PortableGroupDefinition, preserveIncomingId: boolean): PortableGroupDefinition => {
      let id = preserveIncomingId ? incoming.id : makeId("group");
      while (groupById.has(id)) id = makeId("group");
      const created = { ...incoming, id };
      localGroups.push(created);
      groupById.set(created.id, created);
      addGroupTitleCandidate(created);
      return created;
    };
    for (const incoming of [...incomingIndex.groups].sort((a, b) => a.order - b.order || a.title.localeCompare(b.title))) {
      let local = groupById.get(incoming.id);
      if (local
        && groupsUsedByUnselectedSections.has(local.id)
        && (normalizedNameKey(local.title) !== normalizedNameKey(incoming.title)
          || !groupScopesEqual(localGroupScopes.get(local.id), incomingGroupScopes.get(incoming.id)))) {
        // A selective import must not rename a group still owned by an
        // unselected catalog or make two independent catalogs share one group.
        // Reuse a prior compatible split on repeat imports, otherwise fork a
        // local group for the selected subjects.
        local = uniqueUnclaimedTitleMatch(incoming.title, incoming.id)
          ?? createMappedGroup(incoming, false);
      } else if (!local) {
        local = uniqueUnclaimedTitleMatch(incoming.title, incoming.id);
      }
      if (!local) {
        local = createMappedGroup(incoming, true);
      } else if (!groupsUsedByUnselectedSections.has(local.id)) {
        const previousTitleKey = normalizedNameKey(local.title);
        local.title = incoming.title;
        local.order = incoming.order;
        const nextTitleKey = normalizedNameKey(local.title);
        if (previousTitleKey !== nextTitleKey) {
          groupsByTitle.get(previousTitleKey)?.delete(local.id);
          addGroupTitleCandidate(local);
        }
      }
      claimedGroupIds.add(local.id);
      groupIdMap.set(incoming.id, local.id);
    }
    const localGroupTitle = (groupId: string): string => groupById.get(groupId)?.title || "Ungrouped";
    const localSubjects = state.subjects.map((subject) => ({ ...subject }));
    const byId = new Map(localSubjects.map((subject) => [subject.id, subject]));
    const configuredPools = new Map<string, Set<string>>();
    const titlePools = new Map<string, Set<string>>();
    const incomingSubjectIds = new Set(incomingIndex.subjects.map((subject) => subject.id));
    const configuredKey = (subject: PortableSubjectDefinition): string => [
      normalizedNameKey(subject.configuredId),
      portableCatalogScope(subject),
      normalizedNameKey(localGroupTitle(subject.groupId)),
    ].join("\0");
    const titleKey = (subject: PortableSubjectDefinition): string => [
      normalizedNameKey(subject.title),
      portableCatalogScope(subject),
      normalizedNameKey(localGroupTitle(subject.groupId)),
    ].join("\0");
    const addToPool = (pool: Map<string, Set<string>>, key: string, id: string): void => {
      const ids = pool.get(key) ?? new Set<string>();
      ids.add(id);
      pool.set(key, ids);
    };
    for (const subject of localSubjects) {
      // Reserve stable-ID matches before considering weaker metadata matches,
      // regardless of the order subjects happen to appear in the package.
      if (incomingSubjectIds.has(subject.id)) continue;
      if (subject.configuredId) addToPool(configuredPools, configuredKey(subject), subject.id);
      // A title is not an identity for a real, resolved Markdown note. Keep
      // weak title matching only for unresolved placeholders so two distinct
      // same-titled notes imported from different vaults cannot be conflated.
      if (!oldResolvedPathById.has(subject.id)) addToPool(titlePools, titleKey(subject), subject.id);
    }
    const removeFromPools = (subject: PortableSubjectDefinition): void => {
      if (subject.configuredId) configuredPools.get(configuredKey(subject))?.delete(subject.id);
      titlePools.get(titleKey(subject))?.delete(subject.id);
    };
    const uniquePoolMatch = (pool: Map<string, Set<string>>, key: string): PortableSubjectDefinition | undefined => {
      const ids = pool.get(key);
      if (!ids || ids.size !== 1) return undefined;
      return byId.get(ids.values().next().value as string);
    };
    for (const incoming of incomingIndex.subjects) {
      const mappedGroupId = groupIdMap.get(incoming.groupId) || incoming.groupId;
      const incomingIsAuthoritative = subjectSectionIsSelected(incoming);
      let local = byId.get(incoming.id);
      const scopeDiffers = local && portableCatalogScope(local) !== portableCatalogScope(incoming);
      const mayReclassify = local
        && mode === "replace"
        && incomingIsAuthoritative
        && subjectSectionIsSelected(local)
        && !(data.settings.workspaceMode === "ent-clinical" && oldResolvedPathById.has(local.id));
      if (local && scopeDiffers && !mayReclassify) {
        // A selected catalog may not repurpose the stable identity of an
        // unselected catalog. In the ENT preset a bound native identity is
        // additionally fixed by its source folder. A dependency from an
        // unselected catalog also needs its own unresolved identity so an
        // imported collection cannot silently point at an unrelated local
        // subject. In every case both catalogs survive intact.
        local = undefined;
      }
      if (!local && incoming.configuredId) {
        local = uniquePoolMatch(configuredPools, configuredKey({ ...incoming, groupId: mappedGroupId }));
      }
      if (!local && !incoming.configuredId) {
        local = uniquePoolMatch(titlePools, titleKey({ ...incoming, groupId: mappedGroupId }));
      }
      if (!local) {
        let id = incoming.id;
        while (byId.has(id)) id = makeId("subject");
        local = { ...incoming, id, groupId: mappedGroupId, parentId: null };
        localSubjects.push(local);
        byId.set(local.id, local);
        result.addedSubjects += 1;
      } else {
        removeFromPools(local);
        result.matchedSubjects += 1;
        if (local.id === incoming.id) result.updatedSubjects += 1;
        if (incomingIsAuthoritative) {
          local.title = incoming.title;
          local.groupId = mappedGroupId;
          local.order = incoming.order;
          local.indexed = incoming.indexed;
          local.configuredId = incoming.configuredId;
          local.recordKind = incoming.recordKind;
          local.libraryId = subjectLibraryId(incoming);
        }
      }
      subjectIdMap.set(incoming.id, local.id);
    }
    for (const incoming of incomingIndex.subjects) {
      const localId = subjectIdMap.get(incoming.id);
      const local = localId ? byId.get(localId) : undefined;
      if (!local) continue;
      if (!subjectSectionIsSelected(incoming)) continue;
      local.parentId = incoming.parentId ? subjectIdMap.get(incoming.parentId) ?? null : null;
    }
    if (mode === "replace") {
      const importedLocalIds = new Set(subjectIdMap.values());
      for (let index = localSubjects.length - 1; index >= 0; index -= 1) {
        const subject = localSubjects[index];
        if (!subject || importedLocalIds.has(subject.id)) continue;
        if (!subjectSectionIsSelected(subject)) continue;
        if (protectedLocalIds.has(subject.id)) {
          subject.indexed = false;
          subject.libraryId = null;
          subject.parentId = null;
          continue;
        }
        localSubjects.splice(index, 1);
      }
    }
    const survivingIds = new Set(localSubjects.map((subject) => subject.id));
    for (const subject of localSubjects) {
      if (subject.parentId && !survivingIds.has(subject.parentId)) subject.parentId = null;
    }
    for (const subjectId of Object.keys(state.resolvedPathBySubjectId)) {
      if (!survivingIds.has(subjectId)) delete state.resolvedPathBySubjectId[subjectId];
    }
    state.relinkableSubjectIds = [...new Set(state.relinkableSubjectIds ?? [])]
      .filter((subjectId) => survivingIds.has(subjectId)
        && Boolean(state.resolvedPathBySubjectId[subjectId]));
    const retainedGroupIds = new Set(localSubjects.map((subject) => subject.groupId));
    for (const localId of groupIdMap.values()) retainedGroupIds.add(localId);
    for (const groupId of unselectedIndexGroupIds) retainedGroupIds.add(groupId);
    state.groups = mode === "replace" ? localGroups.filter((group) => retainedGroupIds.has(group.id)) : localGroups;
    state.subjects = localSubjects;
    const incomingLibraryLayouts = incomingIndex.libraryLayouts
      ?? cleanLibraryLayouts(
        undefined,
        incomingIndex.groups,
        incomingIndex.subjects,
        incomingLibraries.map((library) => ({ ...library, archivedAt: null })),
      );
    for (const libraryId of selection.libraryIds) {
      const translated = translateLibraryLayout(incomingLibraryLayouts[libraryId] ?? [], subjectIdMap);
      state.libraryLayouts[libraryId] = mode === "replace"
        ? translated
        : mergeLibraryLayout(state.libraryLayouts[libraryId] ?? [], translated, libraryId);
    }
    reconcilePortableLibraryLayouts(state);

    if (mode === "replace") {
      const oldSet = new Set(replacedOldPaths);
      data.manualIndexPaths = data.manualIndexPaths.filter((path) => !oldSet.has(path));
      const nextExcluded = new Set(data.excludedIndexPaths.filter((path) => !isPortablePlaceholderPath(path) && !oldSet.has(path)));
      const survivingById = new Map(localSubjects.map((subject) => [subject.id, subject]));
      for (const subject of oldSubjects) {
        const resolvedPath = oldResolvedPathById.get(subject.id);
        const surviving = survivingById.get(subject.id);
        // Replace never deletes Markdown. A local note that remains inside the
        // generic auto-index folder must be explicitly hidden when its old
        // subject is absent or non-indexed, or it would immediately reappear.
        if (data.settings.workspaceMode === "generic" && resolvedPath
          && pathIsInsideFolder(resolvedPath, data.settings.primaryFolder) && !surviving?.indexed) {
          nextExcluded.add(resolvedPath);
        }
      }
      data.excludedIndexPaths = [...nextExcluded];
      for (const path of replacedOldPaths) {
        delete data.indexGroupByPath[path];
        delete data.curriculumVisual.parentByPath[path];
      }
      for (const [key, paths] of Object.entries(data.curriculumVisual.orderByContainer)) {
        data.curriculumVisual.orderByContainer[key] = paths.filter((path) => !oldSet.has(path));
      }
    }

    const importedContainers = new Map<string, Array<{ path: string; order: number }>>();
    const manualIndexPaths = new Set(data.manualIndexPaths);
    const excludedIndexPaths = new Set(data.excludedIndexPaths);
    for (const incoming of incomingIndex.subjects) {
      const localId = subjectIdMap.get(incoming.id);
      const local = localId ? byId.get(localId) : undefined;
      if (!local) continue;
      const path = portableSubjectPath(data, local.id);
      if (!subjectSectionIsSelected(incoming)) {
        if (isPortablePlaceholderPath(path)) result.unresolvedSubjects += 1;
        continue;
      }
      const groupTitle = localGroupTitle(local.groupId);
      if (local.indexed) {
        data.indexGroupByPath[path] = groupTitle;
        excludedIndexPaths.delete(path);
        if (isPortablePlaceholderPath(path) || !pathIsInsideFolder(path, data.settings.primaryFolder)) {
          manualIndexPaths.add(path);
        }
        const parentPath = local.parentId ? portableSubjectPath(data, local.parentId) : null;
        data.curriculumVisual.parentByPath[path] = parentPath;
        const container = curriculumContainerKey(groupTitle, parentPath);
        const siblings = importedContainers.get(container) ?? [];
        siblings.push({ path, order: local.order });
        importedContainers.set(container, siblings);
      } else if (mode === "replace" && data.settings.workspaceMode === "generic"
        && !isPortablePlaceholderPath(path) && pathIsInsideFolder(path, data.settings.primaryFolder)) {
        excludedIndexPaths.add(path);
        delete data.indexGroupByPath[path];
        delete data.curriculumVisual.parentByPath[path];
      } else {
        delete data.indexGroupByPath[path];
        delete data.curriculumVisual.parentByPath[path];
      }
      if (isPortablePlaceholderPath(path)) result.unresolvedSubjects += 1;
    }
    data.manualIndexPaths = [...manualIndexPaths];
    data.excludedIndexPaths = [...excludedIndexPaths];
    for (const [container, entries] of importedContainers) {
      const incomingPaths = entries.sort((a, b) => a.order - b.order).map((entry) => entry.path);
      data.curriculumVisual.orderByContainer[container] = mergeOrdered(data.curriculumVisual.orderByContainer[container] ?? [], incomingPaths);
    }
    if (incomingIndex.includeIndex !== false) {
      const selectedIndexGroupIds = new Set(incomingIndex.indexGroupIds
        ?? incomingIndex.groups.map((group) => group.id));
      const incomingGroupTitles = incomingIndex.groups
        .filter((group) => selectedIndexGroupIds.has(group.id))
        .sort((a, b) => a.order - b.order)
        .map((group) => localGroupTitle(groupIdMap.get(group.id) || group.id));
      const stateSubjectGroupIds = new Set(state.subjects.map((subject) => subject.groupId));
      const stateIndexedGroupIds = new Set(state.subjects.filter((subject) => subject.indexed).map((subject) => subject.groupId));
      const remainingIndexGroups = state.groups
        .filter((group) => !incomingGroupTitles.includes(group.title)
          && (stateIndexedGroupIds.has(group.id) || !stateSubjectGroupIds.has(group.id)))
        .sort((a, b) => a.order - b.order)
        .map((group) => group.title);
      data.indexGroupOrder = mode === "merge"
        ? unique([...data.indexGroupOrder, ...incomingGroupTitles])
        : unique([...incomingGroupTitles, ...remainingIndexGroups]);
    }
    if (incomingIndex.includeIndex !== false && incomingIndex.collapsedGroupIds) {
      const incomingCollapsedGroups = unique(incomingIndex.collapsedGroupIds
        .map((groupId) => localGroupTitle(groupIdMap.get(groupId) || groupId)));
      data.collapsed.curriculumDomains = mode === "merge"
        ? unique([...data.collapsed.curriculumDomains, ...incomingCollapsedGroups])
        : incomingCollapsedGroups;
    }
    if (incomingIndex.includeIndex !== false && incomingIndex.collapsedSubjectIds) {
      const incomingCollapsedSubjects = unique(incomingIndex.collapsedSubjectIds
        .map((subjectId) => subjectIdMap.get(subjectId) || subjectId)
        .map((subjectId) => portableSubjectPath(data, subjectId)));
      data.collapsed.curriculumNodes = mode === "merge"
        ? unique([...data.collapsed.curriculumNodes, ...incomingCollapsedSubjects])
        : incomingCollapsedSubjects;
    }
  }

  const translateIds = (ids: string[]): string[] => unique(ids.map((id) => subjectIdMap.get(id) || id).map((id) => portableSubjectPath(data, id)));
  if (selection.collections && value.components.collections) {
    const toLayoutSubheading = (subheading: PortableCollectionSubheadingV1): LayoutSubheading => {
      const children = subheading.subheadings ?? [];
      return {
        id: subheading.id,
        title: subheading.title,
        collapsed: subheading.collapsed,
        subjects: translateIds(subheading.subjectIds),
        ...(children.length > 0 ? { subheadings: children.map(toLayoutSubheading) } : {}),
      };
    };
    const incomingHeadings: LayoutHeading[] = value.components.collections.collections.map((collection) => ({
      id: collection.id,
      title: collection.title,
      collapsed: collection.collapsed,
      subjects: translateIds(collection.subjectIds),
      subheadings: collection.subheadings.map(toLayoutSubheading),
    }));
    result.importedCollections = incomingHeadings.length;
    if (mode === "replace") data.collections = incomingHeadings;
    else data.collections = mergeCollectionsLayout(data.collections, incomingHeadings);
  }
  if (selection.study && value.components.study) {
    const pinned = translateIds(value.components.study.pinnedSubjectIds);
    const next = translateIds(value.components.study.nextSubjectIds);
    data.pinnedPaths = mode === "merge" ? unique([...data.pinnedPaths, ...pinned]) : pinned;
    data.nextStudyPaths = mode === "merge" ? unique([...data.nextStudyPaths, ...next]) : next;
  }
  if (selection.savedViews && value.components.savedViews) {
    // Do not retarget a named view to another tab: that would preserve the
    // label while silently changing its meaning. Omit only incoming views whose
    // dependency is missing or locally archived.
    const incomingViews = value.components.savedViews.views
      .filter((view) => navigationTabIsAvailable(view.tab));
    result.importedViews = incomingViews.length;
    if (mode === "replace") data.savedViews = incomingViews.map((view) => ({ ...view }));
    else {
      const viewById = new Map(data.savedViews.map((view) => [view.id, view]));
      for (const incoming of incomingViews) {
        const existing = viewById.get(incoming.id);
        if (existing) Object.assign(existing, incoming);
        else {
          const added = { ...incoming };
          data.savedViews.push(added);
          viewById.set(added.id, added);
        }
      }
    }
  }
  return result;
}
