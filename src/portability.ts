import {
  asUnknownRecord,
  assertPersonalBackupMatchesVault,
  buildCurriculumTree,
  canonicalIdIsValid,
  cloneCollections,
  cloneCurriculumVisual,
  createPersonalBackup,
  createWorkspaceConfig,
  curriculumContainerKey,
  isPortablePlaceholderPath,
  isSafeObjectKey,
  LayoutHeading,
  MainTab,
  makeId,
  MAX_TRANSFER_COLLECTIONS,
  MAX_TRANSFER_LIST_ITEMS,
  MAX_TRANSFER_TOTAL_REFERENCES,
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
  SavedView,
  VaultRecord,
  WorkspaceConfig,
} from "./model";

export const PORTABLE_EXPORT_KIND = "knowledge-base-command-center-portable-export" as const;
/**
 * Version 2 makes the selected subject catalogs explicit. Older builds reject
 * it instead of misreading a library-only package as an authoritative index.
 * The importer continues to accept the original version 1 format.
 */
export const PORTABLE_EXPORT_VERSION = 2 as const;
const LEGACY_PORTABLE_EXPORT_VERSION = 1 as const;
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
  procedures: boolean;
  medications: boolean;
  syndromes: boolean;
  collections: boolean;
  study: boolean;
  savedViews: boolean;
  recovery: boolean;
}

export const COMPLETE_PORTABLE_SELECTION: PortableExportSelection = {
  workspace: true,
  index: true,
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
  procedures: false,
  medications: false,
  syndromes: false,
  collections: false,
  study: false,
  savedViews: false,
  recovery: false,
};

export interface PortableCatalogSelection {
  index: boolean;
  procedures: boolean;
  medications: boolean;
  syndromes: boolean;
}

export interface PortableIndexV1 {
  version: 1 | 2;
  groups: PortableGroupDefinition[];
  subjects: PortableSubjectDefinition[];
  /** Version 2 packages declare exactly which catalogs are authoritative. */
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
  version: typeof LEGACY_PORTABLE_EXPORT_VERSION | typeof PORTABLE_EXPORT_VERSION;
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
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`This export cannot be safely re-imported: ${detail}`);
  }
  return serialized;
}

function normalizeText(value: string): string {
  return value.trim().normalize("NFC").toLocaleLowerCase();
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
  return ["curriculum", "inbox", "collections", "queues", "procedures", "medications", "syndromes"].includes(String(value));
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

export function normalizePortableSelection(selection: PortableExportSelection): PortableExportSelection {
  // The explicit defaults also keep older callers/tests that predate a newly
  // added section from emitting `undefined` provenance fields.
  return { ...EMPTY_PORTABLE_SELECTION, ...selection };
}

function selectionNeedsSubjectCatalog(selection: PortableExportSelection): boolean {
  return selection.index
    || selection.procedures
    || selection.medications
    || selection.syndromes
    || selection.collections
    || selection.study;
}

function libraryKindIsSelected(kind: RecordKind, selection: PortableExportSelection): boolean {
  return (kind === "procedure" && selection.procedures)
    || (kind === "medication" && selection.medications)
    || (kind === "syndrome" && selection.syndromes);
}

function catalogSelectionFromExport(selection: PortableExportSelection): PortableCatalogSelection {
  return {
    index: selection.index,
    procedures: selection.procedures,
    medications: selection.medications,
    syndromes: selection.syndromes,
  };
}

export function portableSelectionHasAny(selection: PortableExportSelection): boolean {
  return Object.values(selection).some(Boolean);
}

export function portableSubjectPath(data: PluginData, subjectId: string): string {
  const bindings = data.portableIndex.resolvedPathBySubjectId;
  const resolved = Object.prototype.hasOwnProperty.call(bindings, subjectId) ? bindings[subjectId] : "";
  return resolved || portablePlaceholderPath(subjectId);
}

export function portableSubjectIdForPath(data: PluginData, path: string): string {
  const placeholderId = portableSubjectIdFromPath(path);
  if (placeholderId) return placeholderId;
  for (const [subjectId, resolvedPath] of Object.entries(data.portableIndex.resolvedPathBySubjectId)) {
    if (resolvedPath === path) return subjectId;
  }
  return "";
}

function ensureGroup(
  data: PluginData,
  title: string,
  byNormalizedTitle: Map<string, PortableGroupDefinition>,
): PortableGroupDefinition {
  const cleanTitle = title.trim() || "Ungrouped";
  const normalized = normalizeText(cleanTitle);
  const existing = byNormalizedTitle.get(normalized);
  if (existing) return existing;
  const group = { id: makeId("group"), title: cleanTitle, order: data.portableIndex.groups.length };
  data.portableIndex.groups.push(group);
  byNormalizedTitle.set(normalized, group);
  return group;
}

function portableGroupsWithTitle(data: PluginData, title: string): PortableGroupDefinition[] {
  const normalized = normalizeText(title);
  return data.portableIndex.groups.filter((group) => normalizeText(group.title) === normalized);
}

function collapsePortableGroups(
  data: PluginData,
  keep: PortableGroupDefinition,
  duplicates: PortableGroupDefinition[],
): void {
  const duplicateIds = new Set(duplicates.filter((group) => group.id !== keep.id).map((group) => group.id));
  if (duplicateIds.size === 0) return;
  for (const subject of data.portableIndex.subjects) {
    if (duplicateIds.has(subject.groupId)) subject.groupId = keep.id;
  }
  data.portableIndex.groups = data.portableIndex.groups.filter((group) => !duplicateIds.has(group.id));
}

/** Register a user-created visual group even when it has no subjects yet. */
export function registerPortableGroup(data: PluginData, title: string): PortableGroupDefinition {
  const cleanTitle = title.trim() || "Ungrouped";
  const existing = portableGroupsWithTitle(data, cleanTitle);
  if (existing[0]) {
    collapsePortableGroups(data, existing[0], existing.slice(1));
    return existing[0];
  }
  const order = data.indexGroupOrder.findIndex((group) => normalizeText(group) === normalizeText(cleanTitle));
  const group = {
    id: makeId("group"),
    title: cleanTitle,
    order: order >= 0 ? order : data.portableIndex.groups.length,
  };
  data.portableIndex.groups.push(group);
  return group;
}

/** Rename a stable group, or merge it into an existing target group. */
export function renameOrMergePortableGroup(data: PluginData, sourceTitle: string, targetTitle: string): void {
  const source = portableGroupsWithTitle(data, sourceTitle);
  const sourceIds = new Set(source.map((group) => group.id));
  const target = portableGroupsWithTitle(data, targetTitle).filter((group) => !sourceIds.has(group.id));
  const keep = target[0] ?? source[0] ?? registerPortableGroup(data, targetTitle);
  keep.title = targetTitle.trim() || "Ungrouped";
  collapsePortableGroups(data, keep, [...source, ...target.slice(1)]);
}

/**
 * Remove an actually empty stable group. A group still referenced by an
 * inactive portable subject remains internal so that subject can be restored;
 * export omits it unless that subject or the group itself is selected.
 */
export function removePortableGroup(data: PluginData, title: string): void {
  const matches = portableGroupsWithTitle(data, title);
  if (matches.length === 0) return;
  const matchingIds = new Set(matches.map((group) => group.id));
  const referencedIds = new Set(data.portableIndex.subjects
    .filter((subject) => matchingIds.has(subject.groupId))
    .map((subject) => subject.groupId));
  const keep = matches.find((group) => referencedIds.has(group.id));
  if (keep) {
    collapsePortableGroups(data, keep, matches.filter((group) => group.id !== keep.id));
    return;
  }
  data.portableIndex.groups = data.portableIndex.groups.filter((group) => !matchingIds.has(group.id));
}

function fallbackTitle(path: string): string {
  return path.split("/").pop()?.replace(/\.md$/i, "").trim() || "Untitled subject";
}

function recordIsIndexed(record: VaultRecord): boolean {
  return record.kind === "topic" && (record.role === "canonical"
    || record.role === "supporting"
    || (record.role === "placeholder" && record.portableIndexed !== false)
    || record.portableIndexed === true);
}

/**
 * Allocates stable IDs once and refreshes only the safe subject catalog fields.
 * It never reads note contents. The caller saves plugin data before exporting.
 */
export function synchronizePortableRegistry(data: PluginData, records: VaultRecord[]): boolean {
  const before = JSON.stringify(data.portableIndex);
  const recordByPath = new Map(records.map((record) => [record.path, record]));
  const indexedPaths = new Set(records.filter(recordIsIndexed).map((record) => record.path));
  for (const path of data.manualIndexPaths) if (isPortablePlaceholderPath(path)) indexedPaths.add(path);
  const requiredPaths = new Set<string>([
    ...indexedPaths,
    ...records
      .filter((record) => record.kind === "procedure" || record.kind === "medication" || record.kind === "syndrome")
      .map((record) => record.path),
    ...data.pinnedPaths,
    ...data.nextStudyPaths,
  ]);
  for (const heading of data.collections) {
    heading.subjects.forEach((path) => requiredPaths.add(path));
    heading.subheadings.forEach((subheading) => subheading.subjects.forEach((path) => requiredPaths.add(path)));
  }

  const subjectById = new Map(data.portableIndex.subjects.map((subject) => [subject.id, subject]));
  for (const subject of data.portableIndex.subjects) subject.indexed = false;
  const pathToId = new Map<string, string>();
  for (const [subjectId, path] of Object.entries(data.portableIndex.resolvedPathBySubjectId)) {
    if (!subjectById.has(subjectId) || pathToId.has(path) || isPortablePlaceholderPath(path)) {
      delete data.portableIndex.resolvedPathBySubjectId[subjectId];
      continue;
    }
    pathToId.set(path, subjectId);
  }

  const groupByNormalizedTitle = new Map<string, PortableGroupDefinition>();
  const groupById = new Map<string, PortableGroupDefinition>();
  for (const group of data.portableIndex.groups) {
    groupById.set(group.id, group);
    const key = normalizeText(group.title);
    if (!groupByNormalizedTitle.has(key)) groupByNormalizedTitle.set(key, group);
  }
  const getGroup = (title: string): PortableGroupDefinition => ensureGroup(data, title, groupByNormalizedTitle);

  const allGroupTitles = unique([
    ...data.indexGroupOrder,
    ...records.map((record) => record.domain),
    ...data.portableIndex.groups.map((group) => group.title),
  ]);
  allGroupTitles.forEach((title) => getGroup(title));

  for (const path of requiredPaths) {
    const placeholderId = portableSubjectIdFromPath(path);
    if (placeholderId && subjectById.has(placeholderId)) {
      const subject = subjectById.get(placeholderId);
      if (subject) subject.indexed = indexedPaths.has(path);
      continue;
    }
    const record = recordByPath.get(path);
    let subjectId = pathToId.get(path);
    const boundSubject = subjectId ? subjectById.get(subjectId) : undefined;
    const preserveGenericLibraryGroup = data.settings.workspaceMode === "generic"
      && boundSubject
      && (boundSubject.recordKind === "procedure"
        || boundSubject.recordKind === "medication"
        || boundSubject.recordKind === "syndrome");
    const stableGroupTitle = preserveGenericLibraryGroup ? groupById.get(boundSubject.groupId)?.title ?? "" : "";
    const group = getGroup(stableGroupTitle || record?.domain || data.indexGroupByPath[path] || "Ungrouped");
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
    subject.indexed = indexedPaths.has(path);
    subject.configuredId = record?.curriculumId || subject.configuredId;
    subject.recordKind = record?.kind || subject.recordKind;
    if (subject.recordKind !== "topic") {
      subject.indexed = false;
      subject.parentId = null;
    }
  }

  // Refresh parent identities and sibling order from the effective visual tree.
  const tree = buildCurriculumTree(records, data.curriculumVisual);
  for (const domain of tree.domains) {
    const visit = (nodes: typeof domain.roots, parentId: string | null): void => {
      nodes.forEach((node, order) => {
        const subjectId = pathToId.get(node.record.path) || portableSubjectIdFromPath(node.record.path);
        const subject = subjectById.get(subjectId);
        if (subject) {
          subject.parentId = parentId;
          subject.order = order;
          subject.indexed = true;
          subject.groupId = getGroup(node.record.domain).id;
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
  const renderedGroupKeys = new Set(tree.domains.map((domain) => normalizeText(domain.domain)));
  const remainingGroups = [...data.portableIndex.groups]
    .sort((a, b) => a.order - b.order || a.title.localeCompare(b.title));
  const effectiveGroupTitles: string[] = [];
  const effectiveGroupKeys = new Set<string>();
  const addEffectiveGroup = (title: string): void => {
    const key = normalizeText(title);
    if (!key || effectiveGroupKeys.has(key)) return;
    effectiveGroupKeys.add(key);
    effectiveGroupTitles.push(title);
  };
  tree.domains.forEach((domain) => addEffectiveGroup(domain.domain));
  data.indexGroupOrder
    .filter((title) => !renderedGroupKeys.has(normalizeText(title)))
    .forEach(addEffectiveGroup);
  remainingGroups.forEach((group) => addEffectiveGroup(group.title));
  const orderByTitle = new Map(effectiveGroupTitles.map((title, order) => [normalizeText(title), order]));
  data.portableIndex.groups.forEach((group, fallback) => {
    group.order = orderByTitle.get(normalizeText(group.title)) ?? (effectiveGroupTitles.length + fallback);
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
  const retainedGroupIds = new Set(data.portableIndex.subjects.map((subject) => subject.groupId));
  const retainedEmptyGroupTitles = new Set(data.indexGroupOrder.map(normalizeText));
  data.portableIndex.groups = data.portableIndex.groups.filter((group) => retainedGroupIds.has(group.id)
    || retainedEmptyGroupTitles.has(normalizeText(group.title)));
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
  const pathToId = pathMapForExport(data);
  const referencedIds = new Set<string>();
  const addPaths = (paths: string[]): void => paths.forEach((path) => {
    const id = pathToId.get(path);
    if (id) referencedIds.add(id);
  });
  if (selection.collections) {
    for (const heading of data.collections) {
      addPaths(heading.subjects);
      heading.subheadings.forEach((subheading) => addPaths(subheading.subjects));
    }
  }
  if (selection.study) {
    addPaths(data.pinnedPaths);
    addPaths(data.nextStudyPaths);
  }
  const includedIds = new Set(data.portableIndex.subjects
    .filter((subject) => (selection.index && subject.indexed)
      || libraryKindIsSelected(subject.recordKind, selection)
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
      parentId: selection.index && subject.recordKind === "topic" ? subject.parentId : null,
      indexed: selection.index && subject.recordKind === "topic" && subject.indexed,
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
  const selectedEmptyGroupTitles = new Set(data.indexGroupOrder.map(normalizeText));
  const groups = data.portableIndex.groups
    .filter((group) => includedGroupIds.has(group.id)
      || (selection.index && selectedEmptyGroupTitles.has(normalizeText(group.title))))
    .map((group) => ({ ...group }))
    .sort((a, b) => a.order - b.order || a.title.localeCompare(b.title));
  const indexedSubjectGroupIds = new Set(subjects
    .filter((subject) => subject.indexed)
    .map((subject) => subject.groupId));
  const indexGroupIds = selection.index ? groups
    .filter((group) => indexedSubjectGroupIds.has(group.id) || selectedEmptyGroupTitles.has(normalizeText(group.title)))
    .map((group) => group.id) : [];
  const groupIdByTitle = new Map(groups.map((group) => [normalizeText(group.title), group.id]));
  const indexGroupIdSet = new Set(indexGroupIds);
  const collapsedGroupIds = unique(data.collapsed.curriculumDomains
    .map((title) => groupIdByTitle.get(normalizeText(title)) ?? "")
    .filter((id) => selection.index && indexGroupIdSet.has(id)));
  const collapsedSubjectIds = selection.index ? unique(data.collapsed.curriculumNodes
    .map((path) => pathToId.get(path) ?? "")
    .filter((id) => includedIds.has(id) && subjectById.get(id)?.indexed)) : [];
  const components: PortableExportV1["components"] = {};
  if (selection.workspace) components.workspace = createWorkspaceConfig(data, exportedAt);
  if (selectionNeedsSubjectCatalog(selection)) {
    components.index = {
      version: 2,
      groups,
      subjects,
      includedSections: catalogSelectionFromExport(selection),
      includeIndex: selection.index,
      indexGroupIds,
      collapsedGroupIds,
      collapsedSubjectIds,
    };
  }
  if (selection.collections) {
    components.collections = {
      version: 1,
      collections: data.collections.map((heading) => ({
        id: heading.id,
        title: heading.title,
        collapsed: heading.collapsed,
        subjectIds: unique(heading.subjects.map((path) => pathToId.get(path) || "").filter((id) => includedIds.has(id))),
        subheadings: heading.subheadings.map((subheading) => ({
          id: subheading.id,
          title: subheading.title,
          collapsed: subheading.collapsed,
          subjectIds: unique(subheading.subjects.map((path) => pathToId.get(path) || "").filter((id) => includedIds.has(id))),
        })),
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

function parsePortableIndex(
  input: unknown,
  packageVersion: typeof LEGACY_PORTABLE_EXPORT_VERSION | typeof PORTABLE_EXPORT_VERSION,
): PortableIndexV1 {
  const value = asUnknownRecord(input);
  if (value.version !== packageVersion || !Array.isArray(value.groups) || !Array.isArray(value.subjects)) {
    throw new Error("Unsupported portable index blueprint.");
  }
  if (value.groups.length > MAX_PORTABLE_GROUPS || value.subjects.length > MAX_PORTABLE_SUBJECTS) throw new Error("The portable index is too large.");
  const groups: PortableGroupDefinition[] = [];
  const groupIds = new Set<string>();
  for (const [index, raw] of value.groups.entries()) {
    const group = asUnknownRecord(raw);
    const id = safeId(group.id, `Group ${index + 1} ID`);
    if (groupIds.has(id)) throw new Error(`Duplicate group ID: ${id}`);
    groupIds.add(id);
    groups.push({ id, title: safeTitle(group.title, `Group ${index + 1} title`), order: safeOrder(group.order, index) });
  }
  const subjects: PortableSubjectDefinition[] = [];
  const subjectIds = new Set<string>();
  for (const [index, raw] of value.subjects.entries()) {
    const subject = asUnknownRecord(raw);
    const id = safeId(subject.id, `Subject ${index + 1} ID`);
    if (subjectIds.has(id)) throw new Error(`Duplicate subject ID: ${id}`);
    const groupId = safeId(subject.groupId, `Subject ${index + 1} group ID`);
    if (!groupIds.has(groupId)) throw new Error(`Subject ${id} references an unknown group.`);
    const parentId = subject.parentId === null || subject.parentId === undefined ? null : safeId(subject.parentId, `Subject ${id} parent ID`);
    if (subject.recordKind !== undefined && !isRecordKind(subject.recordKind)) throw new Error(`Subject ${id} has an unsupported record kind.`);
    const recordKind = isRecordKind(subject.recordKind) ? subject.recordKind : "topic";
    const configuredId = typeof subject.configuredId === "string" ? subject.configuredId.trim() : "";
    if (configuredId.length > MAX_PORTABLE_TITLE_LENGTH) throw new Error(`Subject ${id} configured ID is too long.`);
    subjectIds.add(id);
    subjects.push({
      id,
      title: safeTitle(subject.title, `Subject ${index + 1} title`),
      groupId,
      parentId: recordKind === "topic" ? parentId : null,
      order: safeOrder(subject.order, index),
      // Library identities never participate in the topic curriculum, even if
      // a malformed or older producer marks them indexed.
      indexed: recordKind === "topic" && subject.indexed !== false,
      configuredId,
      recordKind,
    });
  }
  const byId = new Map(subjects.map((subject) => [subject.id, subject]));
  for (const subject of subjects) {
    if (!subject.parentId) continue;
    const parent = byId.get(subject.parentId);
    if (!parent) throw new Error(`Subject ${subject.id} references an unknown parent.`);
    if (parent.id === subject.id) throw new Error(`Subject ${subject.id} cannot be its own parent.`);
    if (parent.groupId !== subject.groupId) throw new Error(`Subject ${subject.id} and its parent are in different groups.`);
  }
  const done = new Set<string>();
  for (const subject of subjects) {
    if (done.has(subject.id)) continue;
    const chain: string[] = [];
    const positions = new Map<string, number>();
    let cursor: PortableSubjectDefinition | undefined = subject;
    while (cursor && !done.has(cursor.id)) {
      const position = positions.get(cursor.id);
      if (position !== undefined) throw new Error(`Portable index hierarchy contains a cycle at ${cursor.id}.`);
      positions.set(cursor.id, chain.length);
      chain.push(cursor.id);
      if (chain.length > MAX_PORTABLE_DEPTH) throw new Error(`Portable index hierarchy exceeds ${MAX_PORTABLE_DEPTH} levels.`);
      cursor = cursor.parentId ? byId.get(cursor.parentId) : undefined;
    }
    chain.forEach((id) => done.add(id));
  }
  const parseCollapsedIds = (
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
  const collapsedGroupIds = parseCollapsedIds(value.collapsedGroupIds, groupIds, "Collapsed index groups", MAX_PORTABLE_GROUPS);
  const collapsedSubjectIds = parseCollapsedIds(value.collapsedSubjectIds, subjectIds, "Collapsed index subjects", MAX_PORTABLE_SUBJECTS);
  if (value.includeIndex !== undefined && typeof value.includeIndex !== "boolean") {
    throw new Error("Portable index includeIndex must be true or false.");
  }
  const indexGroupIds = parseCollapsedIds(value.indexGroupIds, groupIds, "Index blueprint groups", MAX_PORTABLE_GROUPS);
  let includedSections: PortableCatalogSelection | undefined;
  if (packageVersion === PORTABLE_EXPORT_VERSION) {
    if (!value.includedSections || typeof value.includedSections !== "object" || Array.isArray(value.includedSections)) {
      throw new Error("Portable version 2 subject catalogs must declare includedSections.");
    }
    const rawSections = value.includedSections as Record<string, unknown>;
    const readSection = (key: keyof PortableCatalogSelection): boolean => {
      if (typeof rawSections[key] !== "boolean") throw new Error(`Portable includedSections.${key} must be true or false.`);
      return rawSections[key];
    };
    includedSections = {
      index: readSection("index"),
      procedures: readSection("procedures"),
      medications: readSection("medications"),
      syndromes: readSection("syndromes"),
    };
    if (typeof value.includeIndex === "boolean" && value.includeIndex !== includedSections.index) {
      throw new Error("Portable index includeIndex conflicts with includedSections.index.");
    }
    if (!includedSections.index && (indexGroupIds?.length ?? 0) > 0) {
      throw new Error("A package without the index blueprint cannot declare index groups.");
    }
  }
  return {
    version: packageVersion,
    groups,
    subjects,
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

function parsePortableCollections(input: unknown, known: Set<string>, budget: PortableReferenceBudget): PortableCollectionsV1 {
  const value = asUnknownRecord(input);
  if (value.version !== 1 || !Array.isArray(value.collections) || value.collections.length > MAX_PORTABLE_COLLECTIONS) {
    throw new Error("Unsupported portable collections component.");
  }
  const ids = new Set<string>();
  let subheadingCount = 0;
  const collections: PortableCollectionV1[] = value.collections.map((raw, collectionIndex) => {
    const collection = asUnknownRecord(raw);
    const id = safeId(collection.id, `Collection ${collectionIndex + 1} ID`);
    if (ids.has(id)) throw new Error(`Duplicate collection ID: ${id}`);
    ids.add(id);
    if (!Array.isArray(collection.subheadings)) throw new Error(`Collection ${id} subheadings must be a list.`);
    subheadingCount += collection.subheadings.length;
    if (subheadingCount > MAX_PORTABLE_COLLECTIONS) throw new Error("The portable collections component has too many subheadings.");
    const subIds = new Set<string>();
    return {
      id,
      title: safeTitle(collection.title, `Collection ${collectionIndex + 1} title`),
      collapsed: collection.collapsed === true,
      subjectIds: parseSubjectIds(collection.subjectIds, known, `Collection ${id} subjects`, budget),
      subheadings: collection.subheadings.map((rawSub, subIndex) => {
        const subheading = asUnknownRecord(rawSub);
        const subId = safeId(subheading.id, `Collection ${id} subheading ${subIndex + 1} ID`);
        if (subIds.has(subId)) throw new Error(`Duplicate subheading ID: ${subId}`);
        subIds.add(subId);
        return {
          id: subId,
          title: safeTitle(subheading.title, `Collection ${id} subheading ${subIndex + 1} title`),
          collapsed: subheading.collapsed === true,
          subjectIds: parseSubjectIds(subheading.subjectIds, known, `Subheading ${subId} subjects`, budget),
        };
      }),
    };
  });
  return { version: 1, collections };
}

function parseSavedViews(input: unknown): PortableSavedViewsV1 {
  const value = asUnknownRecord(input);
  if (value.version !== 1 || !Array.isArray(value.views) || value.views.length > MAX_PORTABLE_COLLECTIONS) throw new Error("Unsupported saved views component.");
  const ids = new Set<string>();
  const views: SavedView[] = value.views.map((raw, index) => {
    const view = asUnknownRecord(raw);
    const id = safeId(view.id, `Saved view ${index + 1} ID`);
    if (ids.has(id)) throw new Error(`Duplicate saved view ID: ${id}`);
    ids.add(id);
    if (!isMainTab(view.tab)) throw new Error(`Saved view ${id} has an unsupported tab.`);
    const query = typeof view.query === "string" ? view.query : "";
    if (query.length > MAX_SAVED_VIEW_QUERY_LENGTH) throw new Error(`Saved view ${id} query is too long.`);
    return { id, name: safeTitle(view.name, `Saved view ${index + 1} name`), tab: view.tab, query };
  });
  return { version: 1, views };
}

export function parsePortableExport(input: unknown): PortableExportV1 {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("The selected file is not a Command Center portable export.");
  const value = input as Record<string, unknown>;
  if (value.kind !== PORTABLE_EXPORT_KIND
    || (value.version !== LEGACY_PORTABLE_EXPORT_VERSION && value.version !== PORTABLE_EXPORT_VERSION)) {
    throw new Error("Unsupported Command Center portable export.");
  }
  const packageVersion = value.version;
  const rawComponents = asUnknownRecord(value.components);
  const components: PortableExportV1["components"] = {};
  const referenceBudget: PortableReferenceBudget = { total: 0 };
  if (rawComponents.workspace !== undefined) components.workspace = parseWorkspaceConfig(rawComponents.workspace);
  if (rawComponents.index !== undefined) components.index = parsePortableIndex(rawComponents.index, packageVersion);
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
  if (packageVersion === PORTABLE_EXPORT_VERSION && components.index) {
    const sections = components.index.includedSections;
    if (!sections) throw new Error("Portable version 2 subject catalogs are missing includedSections.");
    const referenced = new Set<string>();
    for (const collection of components.collections?.collections ?? []) {
      collection.subjectIds.forEach((id) => referenced.add(id));
      collection.subheadings.forEach((subheading) => subheading.subjectIds.forEach((id) => referenced.add(id)));
    }
    components.study?.pinnedSubjectIds.forEach((id) => referenced.add(id));
    components.study?.nextSubjectIds.forEach((id) => referenced.add(id));
    for (const subject of components.index.subjects) {
      const explicitlyIncluded = (subject.recordKind === "topic" && sections.index)
        || (subject.recordKind === "procedure" && sections.procedures)
        || (subject.recordKind === "medication" && sections.medications)
        || (subject.recordKind === "syndrome" && sections.syndromes);
      if (!explicitlyIncluded && !referenced.has(subject.id)) {
        throw new Error(`Portable subject ${subject.id} belongs to an undeclared catalog and is not referenced by an included section.`);
      }
    }
  }
  if (rawComponents.savedViews !== undefined) components.savedViews = parseSavedViews(rawComponents.savedViews);
  if (rawComponents.recovery !== undefined) components.recovery = parsePersonalBackup(rawComponents.recovery);
  if (Object.keys(components).length === 0) throw new Error("This portable export contains no supported components.");
  const sourceWorkspace = typeof value.sourceWorkspace === "string" ? value.sourceWorkspace : "";
  if (sourceWorkspace.length > MAX_PORTABLE_TITLE_LENGTH) throw new Error("Source workspace name is too long.");
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
  const sections = value.version === PORTABLE_EXPORT_VERSION ? index?.includedSections : undefined;
  return {
    workspace: Boolean(value.components.workspace),
    // Version 1 never declared full clinical-library catalogs; any non-topic
    // subjects in it are dependencies of Collections or Study state.
    index: Boolean(index) && (sections ? sections.index : index?.includeIndex !== false),
    procedures: sections?.procedures === true,
    medications: sections?.medications === true,
    syndromes: sections?.syndromes === true,
    collections: Boolean(value.components.collections),
    study: Boolean(value.components.study),
    savedViews: Boolean(value.components.savedViews),
    recovery: Boolean(value.components.recovery),
  };
}

export function summarizePortableExport(
  value: PortableExportV1,
  requestedSelection?: PortableExportSelection,
): PortableExportSummary {
  const index = requestedSelection
    ? portableIndexForSelection(value, normalizePortableSelection(requestedSelection))
    : value.components.index;
  return {
    groups: index?.indexGroupIds?.length ?? (index?.includeIndex === false ? 0 : index?.groups.length ?? 0),
    subjects: index?.subjects.length ?? 0,
    indexSubjects: index?.subjects.filter((subject) => subject.recordKind === "topic" && subject.indexed).length ?? 0,
    procedures: index?.subjects.filter((subject) => subject.recordKind === "procedure").length ?? 0,
    medications: index?.subjects.filter((subject) => subject.recordKind === "medication").length ?? 0,
    syndromes: index?.subjects.filter((subject) => subject.recordKind === "syndrome").length ?? 0,
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

function portableIndexForSelection(
  value: PortableExportV1,
  selection: PortableExportSelection,
): PortableIndexV1 | undefined {
  const index = value.components.index;
  if (!index || !selectionNeedsSubjectCatalog(selection)) return undefined;

  const referencedIds = new Set<string>();
  if (selection.collections) {
    for (const collection of value.components.collections?.collections ?? []) {
      collection.subjectIds.forEach((id) => referencedIds.add(id));
      collection.subheadings.forEach((subheading) => subheading.subjectIds.forEach((id) => referencedIds.add(id)));
    }
  }
  if (selection.study) {
    value.components.study?.pinnedSubjectIds.forEach((id) => referencedIds.add(id));
    value.components.study?.nextSubjectIds.forEach((id) => referencedIds.add(id));
  }

  const subjectById = new Map(index.subjects.map((subject) => [subject.id, subject]));
  const includedIds = new Set(index.subjects
    .filter((subject) => (selection.index && subject.recordKind === "topic")
      || libraryKindIsSelected(subject.recordKind, selection)
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
      parentId: selection.index && subject.recordKind === "topic" ? subject.parentId : null,
      indexed: selection.index && subject.recordKind === "topic" && subject.indexed,
    }));
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
    ...(index.version === 2 ? { includedSections: catalogSelectionFromExport(selection) } : {}),
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
  const available = selectionAvailableForExport(value);
  for (const key of Object.keys(selection) as Array<keyof PortableExportSelection>) {
    if (selection[key] && !available[key]) throw new Error(`The export does not contain the selected ${key} component.`);
  }
  if (selection.recovery) {
    const otherSelected = Object.entries(selection).some(([key, enabled]) => key !== "recovery" && enabled);
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

  if (selection.recovery && value.components.recovery) applyRecovery(data, value.components.recovery);
  if (incomingWorkspace) {
    // A portable package configures the active base; it must never change the
    // destination base's stable identity. Otherwise importing an ENT package
    // into Research could leave two indistinguishable "ENT" bases in the
    // switcher. The source name remains available as export metadata.
    const destinationWorkspaceName = data.settings.workspaceName;
    const destinationMode = data.settings.workspaceMode;
    const protectedPrimaryFolder = data.settings.primaryFolder;
    data.settings = {
      ...structuredClone(incomingWorkspace.settings),
      workspaceName: destinationWorkspaceName,
      workspaceMode: destinationMode,
      ...(destinationMode === "ent-clinical" ? { primaryFolder: protectedPrimaryFolder } : {}),
      setupComplete: true,
    };
    if (!selection.index) data.indexGroupOrder = [...incomingWorkspace.indexGroupOrder];
  }

  const incomingIndex = portableIndexForSelection(value, selection);
  const subjectIdMap = new Map<string, string>();
  if (incomingIndex) {
    const state = data.portableIndex;
    const oldSubjects = state.subjects.map((subject) => ({ ...subject }));
    const subjectSectionIsSelected = (subject: PortableSubjectDefinition): boolean => (
      (selection.index && subject.recordKind === "topic")
      || libraryKindIsSelected(subject.recordKind, selection)
    );
    const groupsUsedByUnselectedSections = new Set(oldSubjects
      .filter((subject) => !subjectSectionIsSelected(subject))
      .map((subject) => subject.groupId));
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
      for (const heading of data.collections) {
        protectPaths(heading.subjects);
        for (const subheading of heading.subheadings) protectPaths(subheading.subjects);
      }
    }
    if (!selection.study) {
      protectPaths(data.pinnedPaths);
      protectPaths(data.nextStudyPaths);
    }

    const localGroups = state.groups.map((group) => ({ ...group }));
    const groupById = new Map(localGroups.map((group) => [group.id, group]));
    const groupsByTitle = new Map<string, Set<string>>();
    for (const group of localGroups) {
      const key = normalizeText(group.title);
      const ids = groupsByTitle.get(key) ?? new Set<string>();
      ids.add(group.id);
      groupsByTitle.set(key, ids);
    }
    const claimedGroupIds = new Set<string>();
    const groupIdMap = new Map<string, string>();
    const addGroupTitleCandidate = (group: PortableGroupDefinition): void => {
      const key = normalizeText(group.title);
      const ids = groupsByTitle.get(key) ?? new Set<string>();
      ids.add(group.id);
      groupsByTitle.set(key, ids);
    };
    const uniqueUnclaimedTitleMatch = (title: string): PortableGroupDefinition | undefined => {
      const candidates = [...(groupsByTitle.get(normalizeText(title)) ?? [])]
        .filter((id) => !claimedGroupIds.has(id));
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
        && normalizeText(local.title) !== normalizeText(incoming.title)) {
        // A selective import must not rename a group still owned by an
        // unselected catalog. Reuse a prior split on repeat imports, otherwise
        // fork a local group for the selected subjects.
        local = uniqueUnclaimedTitleMatch(incoming.title)
          ?? createMappedGroup(incoming, false);
      } else if (!local) {
        local = uniqueUnclaimedTitleMatch(incoming.title);
      }
      if (!local) {
        local = createMappedGroup(incoming, true);
      } else if (!groupsUsedByUnselectedSections.has(local.id)) {
        const previousTitleKey = normalizeText(local.title);
        local.title = incoming.title;
        local.order = incoming.order;
        const nextTitleKey = normalizeText(local.title);
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
      normalizeText(subject.configuredId),
      subject.recordKind,
      normalizeText(localGroupTitle(subject.groupId)),
    ].join("\0");
    const titleKey = (subject: PortableSubjectDefinition): string => [
      normalizeText(subject.title),
      subject.recordKind,
      normalizeText(localGroupTitle(subject.groupId)),
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
      addToPool(titlePools, titleKey(subject), subject.id);
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
      let local = byId.get(incoming.id);
      if (!local && incoming.configuredId) {
        local = uniquePoolMatch(configuredPools, configuredKey({ ...incoming, groupId: mappedGroupId }));
      }
      if (!local && !incoming.configuredId) {
        local = uniquePoolMatch(titlePools, titleKey({ ...incoming, groupId: mappedGroupId }));
      }
      if (!local) {
        local = { ...incoming, groupId: mappedGroupId, parentId: null };
        localSubjects.push(local);
        byId.set(local.id, local);
        result.addedSubjects += 1;
      } else {
        removeFromPools(local);
        result.matchedSubjects += 1;
        if (local.id === incoming.id) result.updatedSubjects += 1;
        local.title = incoming.title;
        local.groupId = mappedGroupId;
        local.order = incoming.order;
        local.indexed = mode === "merge" ? local.indexed || incoming.indexed : incoming.indexed;
        local.configuredId = incoming.configuredId;
        local.recordKind = incoming.recordKind;
      }
      subjectIdMap.set(incoming.id, local.id);
    }
    for (const incoming of incomingIndex.subjects) {
      const localId = subjectIdMap.get(incoming.id);
      const local = localId ? byId.get(localId) : undefined;
      if (!local) continue;
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
    const retainedGroupIds = new Set(localSubjects.map((subject) => subject.groupId));
    for (const localId of groupIdMap.values()) retainedGroupIds.add(localId);
    state.groups = mode === "replace" ? localGroups.filter((group) => retainedGroupIds.has(group.id)) : localGroups;
    state.subjects = localSubjects;

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
    const incomingHeadings: LayoutHeading[] = value.components.collections.collections.map((collection) => ({
      id: collection.id,
      title: collection.title,
      collapsed: collection.collapsed,
      subjects: translateIds(collection.subjectIds),
      subheadings: collection.subheadings.map((subheading) => ({
        id: subheading.id,
        title: subheading.title,
        collapsed: subheading.collapsed,
        subjects: translateIds(subheading.subjectIds),
      })),
    }));
    result.importedCollections = incomingHeadings.length;
    if (mode === "replace") data.collections = incomingHeadings;
    else {
      const incomingCollectionIds = new Set(incomingHeadings.map((heading) => heading.id));
      const collectionById = new Map(data.collections.map((heading) => [heading.id, heading]));
      const collectionsByTitle = new Map<string, Set<string>>();
      for (const heading of data.collections) {
        if (incomingCollectionIds.has(heading.id)) continue;
        const key = normalizeText(heading.title);
        const ids = collectionsByTitle.get(key) ?? new Set<string>();
        ids.add(heading.id);
        collectionsByTitle.set(key, ids);
      }
      for (const incoming of incomingHeadings) {
        let existing = collectionById.get(incoming.id);
        if (!existing) {
          const candidates = collectionsByTitle.get(normalizeText(incoming.title));
          if (candidates?.size === 1) existing = collectionById.get(candidates.values().next().value as string);
        }
        if (!existing) {
          data.collections.push(incoming);
          collectionById.set(incoming.id, incoming);
          continue;
        }
        collectionsByTitle.get(normalizeText(existing.title))?.delete(existing.id);
        existing.title = incoming.title;
        existing.subjects = unique([...existing.subjects, ...incoming.subjects]);
        const subheadingById = new Map(existing.subheadings.map((subheading) => [subheading.id, subheading]));
        for (const incomingSub of incoming.subheadings) {
          const existingSub = subheadingById.get(incomingSub.id);
          if (existingSub) {
            existingSub.title = incomingSub.title;
            existingSub.subjects = unique([...existingSub.subjects, ...incomingSub.subjects]);
          } else {
            existing.subheadings.push(incomingSub);
            subheadingById.set(incomingSub.id, incomingSub);
          }
        }
      }
    }
  }
  if (selection.study && value.components.study) {
    const pinned = translateIds(value.components.study.pinnedSubjectIds);
    const next = translateIds(value.components.study.nextSubjectIds);
    data.pinnedPaths = mode === "merge" ? unique([...data.pinnedPaths, ...pinned]) : pinned;
    data.nextStudyPaths = mode === "merge" ? unique([...data.nextStudyPaths, ...next]) : next;
  }
  if (selection.savedViews && value.components.savedViews) {
    result.importedViews = value.components.savedViews.views.length;
    if (mode === "replace") data.savedViews = value.components.savedViews.views.map((view) => ({ ...view }));
    else {
      const viewById = new Map(data.savedViews.map((view) => [view.id, view]));
      for (const incoming of value.components.savedViews.views) {
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
