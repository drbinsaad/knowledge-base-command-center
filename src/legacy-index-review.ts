import {
  MAX_TRANSFER_LIST_ITEMS,
  MAX_TRANSFER_TOTAL_REFERENCES,
  MAX_TRANSFER_TEXT_LENGTH,
  INDEX_FOLDER_VAULT_ROOT,
  configuredGroupFromIndexRoot,
  fingerprintText,
  isPortablePlaceholderPath,
  pathIsInIndexFolderSources,
  pathIsInsideFolder,
  recordBelongsToIndex,
  type IndexFolderSource,
  type PluginData,
  type RecordKind,
  type VaultRecord,
} from "./model";

/** Keep a review preview bounded even if a vault contains an abnormal number of notes. */
export const MAX_LEGACY_INDEX_REVIEW_CANDIDATES = MAX_TRANSFER_TOTAL_REFERENCES;

export interface LegacyIndexReviewCandidate {
  path: string;
  title: string;
  domain: string;
  kind: RecordKind;
}

/**
 * Exact, read-only preview of the real notes whose membership depends on one
 * migrated primary-folder source and on no other membership source.
 */
export interface LegacyIndexReviewPlan {
  version: 1;
  source: IndexFolderSource;
  /** False when a non-root source folder has not arrived on this device yet. */
  sourceFolderAvailable: boolean;
  candidates: LegacyIndexReviewCandidate[];
  /** Remaining canonical direct-membership slots in this knowledge base. */
  preserveCapacity: number;
  /** Fingerprint of the direct, hidden, and linked-source state used by the preview. */
  stateFingerprint: string;
  /** Fingerprint of both state and the visible candidate identities/classification. */
  fingerprint: string;
}

/** One reviewed choice: preserve these candidates directly, then unlink the source. */
export interface LegacyIndexReviewCommitPlan {
  review: LegacyIndexReviewPlan;
  preservePaths: string[];
  fingerprint: string;
}

export interface LegacyIndexReviewInput {
  data: PluginData;
  records: readonly VaultRecord[];
  existingMarkdownPaths: ReadonlySet<string>;
  sourceFolderAvailable: boolean;
  sourceId: string;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function sourceCopy(source: IndexFolderSource): IndexFolderSource {
  return { id: source.id, path: source.path, origin: source.origin };
}

function reviewStateFingerprint(data: PluginData): string {
  return fingerprintText(JSON.stringify({
    workspaceMode: data.settings.workspaceMode,
    primaryFolder: data.settings.primaryFolder,
    directIndexPaths: data.directIndexPaths,
    manualIndexPaths: data.manualIndexPaths,
    excludedIndexPaths: data.excludedIndexPaths,
    indexFolderSources: data.indexFolderSources.map(sourceCopy),
    indexGroupByPath: data.indexGroupByPath,
    indexGroupAliases: data.indexGroupAliases,
  }));
}

function candidateFingerprint(candidate: LegacyIndexReviewCandidate): string {
  return fingerprintText(JSON.stringify({
    path: candidate.path,
    title: candidate.title,
    domain: candidate.domain,
    kind: candidate.kind,
  }));
}

function planFingerprint(
  stateFingerprint: string,
  source: IndexFolderSource,
  sourceFolderAvailable: boolean,
  candidates: readonly LegacyIndexReviewCandidate[],
  preserveCapacity: number,
): string {
  // Hash candidates individually so a maximum-size preview does not duplicate
  // every title and path in one large intermediate JSON string.
  return fingerprintText(JSON.stringify({
    version: 1,
    stateFingerprint,
    source: sourceCopy(source),
    sourceFolderAvailable,
    preserveCapacity,
    candidates: candidates.map(candidateFingerprint),
  }));
}

function commitFingerprint(reviewFingerprint: string, preservePaths: readonly string[]): string {
  return fingerprintText(JSON.stringify({
    version: 1,
    reviewFingerprint,
    preservePaths,
  }));
}

function candidateIsStructurallyValid(candidate: LegacyIndexReviewCandidate): boolean {
  return Boolean(candidate.path
    && candidate.path.length <= MAX_TRANSFER_TEXT_LENGTH
    && candidate.path.toLowerCase().endsWith(".md")
    && !isPortablePlaceholderPath(candidate.path)
    && typeof candidate.title === "string"
    && candidate.title.length <= MAX_TRANSFER_TEXT_LENGTH
    && typeof candidate.domain === "string"
    && candidate.domain.length <= MAX_TRANSFER_TEXT_LENGTH
    && ["topic", "procedure", "medication", "syndrome", "proposal", "note"].includes(candidate.kind));
}

function planIsInternallyValid(plan: LegacyIndexReviewPlan): boolean {
  if (plan.version !== 1
    || plan.source.origin !== "legacy-primary-folder"
    || !plan.source.id
    || !plan.source.path
    || typeof plan.sourceFolderAvailable !== "boolean"
    || !Number.isSafeInteger(plan.preserveCapacity)
    || plan.preserveCapacity < 0
    || plan.preserveCapacity > MAX_TRANSFER_LIST_ITEMS
    || !/^[0-9a-f]{16}$/u.test(plan.stateFingerprint)
    || plan.candidates.length > MAX_LEGACY_INDEX_REVIEW_CANDIDATES) return false;
  let previousPath = "";
  for (const candidate of plan.candidates) {
    if (!candidateIsStructurallyValid(candidate)
      || (previousPath && compareText(previousPath, candidate.path) >= 0)) return false;
    previousPath = candidate.path;
  }
  return plan.fingerprint === planFingerprint(
    plan.stateFingerprint,
    plan.source,
    plan.sourceFolderAvailable,
    plan.candidates,
    plan.preserveCapacity,
  );
}

function exactLegacySource(data: PluginData, sourceId: string): IndexFolderSource {
  const matches = data.indexFolderSources.filter((source) => source.id === sourceId);
  if (matches.length !== 1 || matches[0]?.origin !== "legacy-primary-folder") {
    throw new Error("That legacy linked-folder source is no longer available for review.");
  }
  return matches[0];
}

/**
 * Build one deterministic review. Candidates are real Markdown records that
 * currently belong to the Index, are not hidden or in a Library, and would
 * lose membership when this source alone is removed.
 */
export function buildLegacyIndexReviewPlan(input: LegacyIndexReviewInput): LegacyIndexReviewPlan {
  const { data, records, existingMarkdownPaths, sourceId } = input;
  if (data.settings.workspaceMode !== "generic") {
    throw new Error("Legacy linked-folder review is available only for a generic knowledge base.");
  }
  const source = exactLegacySource(data, sourceId);
  const sourceFolderAvailable = source.path === INDEX_FOLDER_VAULT_ROOT || input.sourceFolderAvailable;
  const otherSources = data.indexFolderSources.filter((candidate) => candidate.id !== source.id);
  const direct = new Set([...data.directIndexPaths, ...data.manualIndexPaths]);
  const excluded = new Set(data.excludedIndexPaths);
  const candidateByPath = new Map<string, LegacyIndexReviewCandidate>();

  for (const record of sourceFolderAvailable ? records : []) {
    if (!existingMarkdownPaths.has(record.path)
      || !record.path.toLowerCase().endsWith(".md")
      || record.isPlaceholder
      || isPortablePlaceholderPath(record.path)
      || direct.has(record.path)
      || excluded.has(record.path)
      || record.libraryId
      || !recordBelongsToIndex(record)
      || !pathIsInIndexFolderSources(record.path, [source])
      || pathIsInIndexFolderSources(record.path, otherSources)) continue;

    const fallbackTitle = record.path.split("/").pop()?.replace(/\.md$/iu, "") || record.path;
    const candidate: LegacyIndexReviewCandidate = {
      path: record.path,
      title: data.displayNameByPath[record.path] || record.title || fallbackTitle,
      domain: record.domain,
      kind: record.kind,
    };
    if (!candidateIsStructurallyValid(candidate)) {
      throw new Error("A note in this legacy linked folder exceeds the safe review limits.");
    }
    const existing = candidateByPath.get(candidate.path);
    // Runtime projections normally contain one record per path. Choosing the
    // ordinal-smallest duplicate keeps a malformed projection deterministic.
    if (!existing || compareText(JSON.stringify(candidate), JSON.stringify(existing)) < 0) {
      candidateByPath.set(candidate.path, candidate);
      if (candidateByPath.size > MAX_LEGACY_INDEX_REVIEW_CANDIDATES) {
        throw new Error(`A legacy linked-folder review can include at most ${MAX_LEGACY_INDEX_REVIEW_CANDIDATES.toLocaleString()} notes.`);
      }
    }
  }
  const candidates = [...candidateByPath.values()].sort((left, right) => compareText(left.path, right.path));
  const stateFingerprint = reviewStateFingerprint(data);
  const copiedSource = sourceCopy(source);
  const preserveCapacity = Math.max(0, MAX_TRANSFER_LIST_ITEMS - data.directIndexPaths.length);
  return {
    version: 1,
    source: copiedSource,
    sourceFolderAvailable,
    candidates,
    preserveCapacity,
    stateFingerprint,
    fingerprint: planFingerprint(stateFingerprint, copiedSource, sourceFolderAvailable, candidates, preserveCapacity),
  };
}

/** Bind an explicit reviewed subset to an immutable preview. */
export function withLegacyIndexReviewSelection(
  plan: LegacyIndexReviewPlan,
  preservePaths: readonly string[],
): LegacyIndexReviewCommitPlan {
  if (!planIsInternallyValid(plan)) throw new Error("The legacy linked-folder preview is invalid. Review it again.");
  if (!plan.sourceFolderAvailable) {
    throw new Error("The linked folder is not available on this device. Let Obsidian Sync finish or restore the folder before unlinking it.");
  }
  if (preservePaths.length > MAX_LEGACY_INDEX_REVIEW_CANDIDATES) {
    throw new Error("The legacy linked-folder selection is too large. Review it again.");
  }
  if (preservePaths.length > plan.preserveCapacity) {
    throw new Error(`This knowledge base can preserve at most ${plan.preserveCapacity.toLocaleString()} more direct Index members.`);
  }
  const candidates = new Set(plan.candidates.map((candidate) => candidate.path));
  const selected = new Set<string>();
  for (const path of preservePaths) {
    if (!candidates.has(path)) throw new Error("A selected note is not part of this legacy linked-folder review.");
    selected.add(path);
  }
  const orderedPaths = [...selected].sort(compareText);
  return {
    review: plan,
    preservePaths: orderedPaths,
    fingerprint: commitFingerprint(plan.fingerprint, orderedPaths),
  };
}

function reviewStillMatchesData(data: PluginData, plan: LegacyIndexReviewPlan): boolean {
  if (!planIsInternallyValid(plan) || reviewStateFingerprint(data) !== plan.stateFingerprint) return false;
  const sources = data.indexFolderSources.filter((source) => source.id === plan.source.id);
  const source = sources[0];
  if (sources.length !== 1
    || !source
    || source.origin !== plan.source.origin
    || source.path !== plan.source.path) return false;

  const direct = new Set([...data.directIndexPaths, ...data.manualIndexPaths]);
  const excluded = new Set(data.excludedIndexPaths);
  const otherSources = data.indexFolderSources.filter((candidate) => candidate.id !== source.id);
  return plan.candidates.every((candidate) => (
    !direct.has(candidate.path)
    && !excluded.has(candidate.path)
    && pathIsInIndexFolderSources(candidate.path, [source])
    && !pathIsInIndexFolderSources(candidate.path, otherSources)
  ));
}

/**
 * Apply the reviewed conversion to one PluginData object. The caller should
 * rebuild and compare the review fingerprint at its queued commit boundary to
 * detect vault/metadata drift; this helper independently rejects data drift.
 */
export function applyLegacyIndexReviewToData(
  data: PluginData,
  commit: LegacyIndexReviewCommitPlan,
): boolean {
  const { review, preservePaths } = commit;
  if (!review.sourceFolderAvailable
    || preservePaths.length > MAX_LEGACY_INDEX_REVIEW_CANDIDATES
    || preservePaths.length > review.preserveCapacity
    || !reviewStillMatchesData(data, review)
    || commit.fingerprint !== commitFingerprint(review.fingerprint, preservePaths)) return false;
  const candidates = new Set(review.candidates.map((candidate) => candidate.path));
  let previousPath = "";
  for (const path of preservePaths) {
    if (!candidates.has(path) || (previousPath && compareText(previousPath, path) >= 0)) return false;
    previousPath = path;
  }

  const remainingSources = data.indexFolderSources.filter((source) => source.id !== review.source.id);
  if (remainingSources.length !== data.indexFolderSources.length - 1) return false;
  const nextDirectPaths = [...data.directIndexPaths];
  const direct = new Set([...data.directIndexPaths, ...data.manualIndexPaths]);
  for (const path of preservePaths) {
    if (!direct.has(path)) {
      direct.add(path);
      nextDirectPaths.push(path);
    }
  }
  if (nextDirectPaths.length > MAX_TRANSFER_LIST_ITEMS) return false;

  const candidateByPath = new Map(review.candidates.map((candidate) => [candidate.path, candidate]));
  const nextIndexGroupByPath = { ...data.indexGroupByPath };
  for (const path of preservePaths) {
    const candidate = candidateByPath.get(path);
    if (!candidate || candidate.kind !== "topic"
      || Object.prototype.hasOwnProperty.call(nextIndexGroupByPath, path)) continue;
    const segments = path.split("/");
    const fallback = segments.length > 1 ? segments[segments.length - 2] || "Ungrouped" : "Ungrouped";
    let groupingRoot = data.settings.primaryFolder
      && pathIsInsideFolder(path, data.settings.primaryFolder)
      ? data.settings.primaryFolder
      : "";
    if (!groupingRoot) {
      for (const source of remainingSources) {
        if (!pathIsInIndexFolderSources(path, [source])) continue;
        const currentScore = groupingRoot === "/" ? 0 : groupingRoot.length;
        const candidateScore = source.path === "/" ? 0 : source.path.length;
        if (!groupingRoot || candidateScore > currentScore) groupingRoot = source.path;
      }
    }
    const derivedGroup = groupingRoot
      ? configuredGroupFromIndexRoot(path, groupingRoot, fallback)
      : fallback;
    const projectedGroup = data.indexGroupAliases[derivedGroup] || derivedGroup;
    if (candidate.domain && candidate.domain !== projectedGroup) {
      nextIndexGroupByPath[path] = candidate.domain;
    }
  }
  if (Object.keys(nextIndexGroupByPath).length > MAX_TRANSFER_LIST_ITEMS) return false;
  const nextExcludedPaths = data.excludedIndexPaths.filter((path) => (
    !pathIsInIndexFolderSources(path, [review.source])
    || direct.has(path)
    || pathIsInIndexFolderSources(path, remainingSources)
  ));

  data.directIndexPaths = nextDirectPaths;
  data.indexFolderSources = remainingSources;
  data.excludedIndexPaths = nextExcludedPaths;
  data.indexGroupByPath = nextIndexGroupByPath;
  return true;
}

/** Record an informed choice to retain the folder as an ordinary user source. */
export function acceptLegacyIndexSourceToData(data: PluginData, plan: LegacyIndexReviewPlan): boolean {
  if (!reviewStillMatchesData(data, plan)) return false;
  const index = data.indexFolderSources.findIndex((source) => source.id === plan.source.id);
  const source = data.indexFolderSources[index];
  if (index < 0 || !source || source.origin !== "legacy-primary-folder") return false;
  const nextSources = data.indexFolderSources.map(sourceCopy);
  const accepted = nextSources[index];
  if (!accepted) return false;
  accepted.origin = "user";
  data.indexFolderSources = nextSources;
  return true;
}
