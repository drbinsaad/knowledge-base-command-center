import {
  asText,
  INDEX_FOLDER_VAULT_ROOT,
  isPortablePlaceholderPath,
  pathIsInIndexFolderSources,
  portablePlaceholderPath,
  type IndexFolderSource,
  type PluginData,
  type PortableSubjectDefinition,
  type VaultRecord,
} from "./model";
import { localeInvariantTaxonomyKey } from "./taxonomy-health";

export interface IndexMembershipExplanation {
  direct: boolean;
  linkedSources: IndexFolderSource[];
  protectedSource: boolean;
  importedPlaceholder: boolean;
  excluded: boolean;
  libraryId: string | null;
  collectionTitles: string[];
  pinned: boolean;
  nextStudy: boolean;
  /** A vault-relative location only. Portable placeholders deliberately have no storage path. */
  storagePath: string | null;
}

/**
 * Explain every applicable Index authority without collapsing them into one
 * winning badge. This is intentionally read-only: UI surfaces can answer
 * “Why is this here?” without creating a new membership source.
 */
export function explainIndexMembership(
  record: VaultRecord,
  data: Pick<PluginData,
    "directIndexPaths" | "manualIndexPaths" | "indexFolderSources" | "excludedIndexPaths"
    | "collections" | "pinnedPaths" | "nextStudyPaths" | "settings">,
): IndexMembershipExplanation {
  const directPaths = new Set([...(data.directIndexPaths ?? []), ...(data.manualIndexPaths ?? [])]);
  const importedPlaceholder = Boolean(record.isPlaceholder || isPortablePlaceholderPath(record.path));
  const generic = data.settings.workspaceMode === "generic";
  const linkedSources = generic && !importedPlaceholder
    ? (data.indexFolderSources ?? []).filter((source) => pathIsInIndexFolderSources(record.path, [source]))
    : [];
  const layoutContains = (node: { subjects: string[]; subheadings?: Array<{ subjects: string[]; subheadings?: unknown[] }> }): boolean => {
    if (node.subjects.includes(record.path)) return true;
    return (node.subheadings ?? []).some((child) => layoutContains(child as typeof node));
  };
  return {
    direct: directPaths.has(record.path),
    linkedSources,
    protectedSource: !generic
      && !importedPlaceholder
      && record.kind === "topic"
      && (record.role === "canonical" || record.role === "supporting"),
    importedPlaceholder,
    excluded: (data.excludedIndexPaths ?? []).includes(record.path),
    libraryId: record.libraryId ?? null,
    collectionTitles: (data.collections ?? []).filter(layoutContains).map((collection) => collection.title),
    pinned: (data.pinnedPaths ?? []).includes(record.path),
    nextStudy: (data.nextStudyPaths ?? []).includes(record.path),
    storagePath: importedPlaceholder ? null : record.path,
  };
}

export type PlaceholderPlacement =
  | { kind: "index"; label: string }
  | { kind: "library"; libraryId: string; label: string }
  | { kind: "unplaced"; label: string };

export interface PlaceholderMatchCandidate {
  path: string;
  title: string;
  configuredId: string;
  matchedByTitle: boolean;
  matchedByConfiguredId: boolean;
  /** Existing portable owners are named so the UI never implies a safe automatic link. */
  existingPortableSubjectIds: string[];
}

/**
 * The deliberately small note projection needed for exact placeholder
 * suggestions. Unlike VaultRecord, this can also represent an eligible
 * Markdown file that is not currently a member of any KBCC catalog.
 */
export interface PlaceholderMatchNote {
  path: string;
  title: string;
  curriculumId: string;
}

export interface PlaceholderRecordProjection {
  path: string;
  portableId?: string;
  isPlaceholder?: boolean;
}

interface EligibleMarkdownNote {
  path: string;
  basename: string;
}

/**
 * Project the exact same eligible Markdown universe used by the manual link
 * picker. Existing KB records retain their effective display title and ID;
 * otherwise the lightweight projection reads only title/ID frontmatter and
 * falls back to the Markdown basename. It never chooses or links a note.
 */
export function buildEligiblePlaceholderMatchNotes<T extends EligibleMarkdownNote>(
  files: readonly T[],
  records: readonly VaultRecord[],
  settings: Pick<PluginData["settings"], "workspaceMode" | "idProperty">,
  frontmatterForFile: (file: T) => Record<string, unknown> | undefined,
): PlaceholderMatchNote[] {
  const recordByPath = new Map(records
    .filter((record) => !record.isPlaceholder && !isPortablePlaceholderPath(record.path))
    .map((record) => [record.path, record]));
  const seen = new Set<string>();
  const projected: PlaceholderMatchNote[] = [];
  for (const file of files) {
    if (seen.has(file.path) || isPortablePlaceholderPath(file.path)) continue;
    seen.add(file.path);
    const record = recordByPath.get(file.path);
    if (record) {
      projected.push({ path: record.path, title: record.title, curriculumId: record.curriculumId });
      continue;
    }
    const frontmatter = frontmatterForFile(file) ?? {};
    const configuredValue = frontmatter[settings.idProperty];
    const configuredIdFromProperty = typeof configuredValue === "number"
      ? String(configuredValue)
      : asText(configuredValue);
    const configuredId = configuredIdFromProperty
      || (settings.workspaceMode === "ent-clinical" ? asText(frontmatter.curriculum_id) : "");
    projected.push({
      path: file.path,
      title: asText(frontmatter.title, asText(frontmatter.canonical_name, file.basename)),
      curriculumId: configuredId,
    });
  }
  return projected;
}

export interface PlaceholderResolutionItem {
  subjectId: string;
  path: string;
  title: string;
  configuredId: string;
  group: string;
  placement: PlaceholderPlacement;
  candidates: PlaceholderMatchCandidate[];
}

export interface PlaceholderResolutionQueue {
  items: PlaceholderResolutionItem[];
  total: number;
  index: number;
  libraries: number;
  unplaced: number;
  withCandidates: number;
}

/** Keep the queue useful without retaining a duplicate-heavy records × subjects cross-product. */
export const MAX_PLACEHOLDER_MATCH_CANDIDATES = 10;

function placementForSubject(
  data: Pick<PluginData, "portableIndex" | "settings">,
  subject: PortableSubjectDefinition,
): PlaceholderPlacement {
  if (subject.libraryId) {
    const library = data.portableIndex.libraries.find((candidate) => candidate.id === subject.libraryId);
    return { kind: "library", libraryId: subject.libraryId, label: library?.name ?? subject.libraryId };
  }
  if (subject.indexed) return { kind: "index", label: data.settings.indexLabel };
  return { kind: "unplaced", label: "Unplaced blueprint" };
}

/**
 * Build the bounded UI model for a base-wide placeholder resolver. Matching is
 * exact under the same locale-invariant title/ID normalization used by
 * Taxonomy Health. It never chooses or links a note automatically.
 */
export function buildPlaceholderResolutionQueue(
  data: Pick<PluginData, "portableIndex" | "settings">,
  records: readonly PlaceholderMatchNote[],
  projectedRecords: readonly PlaceholderRecordProjection[] = [],
): PlaceholderResolutionQueue {
  const localRecords = records.filter((record) => !isPortablePlaceholderPath(record.path));
  const byTitle = new Map<string, PlaceholderMatchNote[]>();
  const byConfiguredId = new Map<string, PlaceholderMatchNote[]>();
  for (const record of localRecords) {
    const titleKey = localeInvariantTaxonomyKey(record.title);
    const titleMatches = byTitle.get(titleKey) ?? [];
    titleMatches.push(record);
    byTitle.set(titleKey, titleMatches);
    if (record.curriculumId) {
      const idKey = localeInvariantTaxonomyKey(record.curriculumId);
      const idMatches = byConfiguredId.get(idKey) ?? [];
      idMatches.push(record);
      byConfiguredId.set(idKey, idMatches);
    }
  }
  const compareCandidateRecords = (left: PlaceholderMatchNote, right: PlaceholderMatchNote): number => (
    left.title.localeCompare(right.title) || left.path.localeCompare(right.path)
  );
  for (const recordsForTitle of byTitle.values()) recordsForTitle.sort(compareCandidateRecords);
  for (const recordsForId of byConfiguredId.values()) recordsForId.sort(compareCandidateRecords);

  const ownersByPath = new Map<string, string[]>();
  for (const [subjectId, path] of Object.entries(data.portableIndex.resolvedPathBySubjectId)) {
    const owners = ownersByPath.get(path) ?? [];
    owners.push(subjectId);
    ownersByPath.set(path, owners);
  }
  for (const owners of ownersByPath.values()) owners.sort();

  const candidateCache = new Map<string, PlaceholderMatchCandidate[]>();
  const candidatesFor = (titleKey: string, idKey: string): PlaceholderMatchCandidate[] => {
    const cacheKey = JSON.stringify([titleKey, idKey]);
    const cached = candidateCache.get(cacheKey);
    if (cached) return cached;
    const matches = new Map<string, { record: PlaceholderMatchNote; title: boolean; id: boolean }>();
    const addMatch = (record: PlaceholderMatchNote, kind: "title" | "id"): void => {
      const current = matches.get(record.path);
      if (current) {
        if (kind === "title") current.title = true;
        else current.id = true;
        return;
      }
      matches.set(record.path, { record, title: kind === "title", id: kind === "id" });
    };
    // Both buckets share the same ordering. A record beyond the first N in
    // either bucket cannot enter the first N of their sorted union.
    for (const record of (byTitle.get(titleKey) ?? []).slice(0, MAX_PLACEHOLDER_MATCH_CANDIDATES)) {
      addMatch(record, "title");
    }
    if (idKey) {
      for (const record of (byConfiguredId.get(idKey) ?? []).slice(0, MAX_PLACEHOLDER_MATCH_CANDIDATES)) {
        addMatch(record, "id");
      }
    }
    const candidates = [...matches.values()]
      .sort((left, right) => compareCandidateRecords(left.record, right.record))
      .slice(0, MAX_PLACEHOLDER_MATCH_CANDIDATES)
      .map(({ record, title, id }): PlaceholderMatchCandidate => ({
        path: record.path,
        title: record.title,
        configuredId: record.curriculumId,
        matchedByTitle: title,
        matchedByConfiguredId: id,
        existingPortableSubjectIds: [...(ownersByPath.get(record.path) ?? [])],
      }));
    candidateCache.set(cacheKey, candidates);
    return candidates;
  };

  const groupById = new Map(data.portableIndex.groups.map((group) => [group.id, group.title]));
  const projectedPlaceholderPathBySubjectId = new Map(projectedRecords
    .filter((record): record is PlaceholderRecordProjection & { portableId: string } => (
      Boolean(record.isPlaceholder && record.portableId)
    ))
    .map((record) => [record.portableId, record.path]));
  const items: PlaceholderResolutionItem[] = [];
  for (const subject of data.portableIndex.subjects) {
    const projectedPlaceholderPath = projectedPlaceholderPathBySubjectId.get(subject.id);
    if (data.portableIndex.resolvedPathBySubjectId[subject.id] && !projectedPlaceholderPath) continue;
    const titleKey = localeInvariantTaxonomyKey(subject.title);
    const idKey = subject.configuredId ? localeInvariantTaxonomyKey(subject.configuredId) : "";
    const candidates = candidatesFor(titleKey, idKey);
    items.push({
      subjectId: subject.id,
      path: projectedPlaceholderPath ?? portablePlaceholderPath(subject.id),
      title: subject.title,
      configuredId: subject.configuredId,
      group: groupById.get(subject.groupId) ?? "Unassigned",
      placement: placementForSubject(data, subject),
      candidates,
    });
  }

  const placementOrder = (item: PlaceholderResolutionItem): number => (
    item.placement.kind === "index" ? 0 : item.placement.kind === "library" ? 1 : 2
  );
  items.sort((left, right) => placementOrder(left) - placementOrder(right)
    || left.placement.label.localeCompare(right.placement.label)
    || left.group.localeCompare(right.group)
    || left.title.localeCompare(right.title)
    || left.subjectId.localeCompare(right.subjectId));
  return {
    items,
    total: items.length,
    index: items.filter((item) => item.placement.kind === "index").length,
    libraries: items.filter((item) => item.placement.kind === "library").length,
    unplaced: items.filter((item) => item.placement.kind === "unplaced").length,
    withCandidates: items.filter((item) => item.candidates.length > 0).length,
  };
}

/** Human label for a linked source, including the deliberate vault-root sentinel. */
export function linkedSourceLabel(source: IndexFolderSource): string {
  return source.path === INDEX_FOLDER_VAULT_ROOT ? "Vault root" : source.path;
}
