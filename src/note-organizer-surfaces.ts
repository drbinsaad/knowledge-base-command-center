import {
  MAX_TRANSFER_LIST_ITEMS,
  MAX_TRANSFER_TEXT_LENGTH,
  childSubheadings,
  codeUnitCompare,
  isPortablePlaceholderPath,
  pathIsInIndexFolderSources,
  portablePlaceholderPath,
  recordBelongsToIndex,
  type LayoutHeading,
  type LayoutSubheading,
  type PluginData,
  type VaultRecord,
} from "./model";
import { MAX_NOTE_ORGANIZER_NOTES } from "./note-organizer";

/** A bounded, reviewable note selection. Applying it is always a later host action. */
export const MAX_NOTE_ORGANIZER_SELECTION_PATHS = Math.min(MAX_TRANSFER_LIST_ITEMS, MAX_NOTE_ORGANIZER_NOTES);
/** Cap a vault snapshot scan independently of the persisted membership limit. */
export const MAX_NOTE_ORGANIZER_SELECTION_CANDIDATES = 250_000;
/** String drag payloads are UI hints, not an unbounded import surface. */
export const MAX_NOTE_ORGANIZER_DROP_TEXT_LENGTH = 256 * 1024;
export const MAX_NOTE_ORGANIZER_DROP_PATHS = MAX_NOTE_ORGANIZER_NOTES;

export type NoteOrganizerPrimaryPlacement =
  | { kind: "none" }
  | { kind: "index"; label: string }
  | { kind: "library"; libraryId: string; label: string }
  | { kind: "conflict"; labels: string[] };

export type NoteOrganizerMembershipProvenance = "direct" | "linked-folder" | "protected" | "portable";

export type NoteOrganizerMembershipIssueKind =
  | "missing-note"
  | "duplicate-portable-owner"
  | "missing-portable-subject"
  | "unknown-library"
  | "conflicting-primary-placement"
  | "direct-and-hidden";

export interface NoteOrganizerMembershipIssue {
  kind: NoteOrganizerMembershipIssueKind;
  detail: string;
}

export type NoteOrganizerRecordProjection = Pick<VaultRecord,
  "path" | "kind" | "role" | "libraryId" | "portableId" | "isPlaceholder" | "portableIndexed">;

export interface NoteOrganizerBaseProjection {
  baseId: string;
  name: string;
  data: Pick<PluginData,
    "collections" | "directIndexPaths" | "manualIndexPaths" | "indexFolderSources"
    | "excludedIndexPaths" | "portableIndex" | "settings">;
  /** The base's live record for this path, when its record scan has one. */
  record?: NoteOrganizerRecordProjection | null;
}

export interface NoteOrganizerBaseMembership {
  baseId: string;
  baseName: string;
  current: boolean;
  primary: NoteOrganizerPrimaryPlacement;
  collectionTitles: string[];
  collectionOnly: boolean;
  organized: boolean;
  provenance: NoteOrganizerMembershipProvenance[];
  linkedSourcePaths: string[];
  portableSubjectIds: string[];
  hidden: boolean;
  hasReference: boolean;
  issues: NoteOrganizerMembershipIssue[];
  broken: boolean;
}

export type NoteOrganizerIndicatorState =
  | "organized-current"
  | "collection-only-current"
  | "organized-other"
  | "not-organized"
  | "broken";

export type NoteOrganizerIndicatorColor = "success" | "accent" | "muted" | "danger";

export interface NoteOrganizerIndicatorModel {
  id: "kbcc-note-membership";
  state: NoteOrganizerIndicatorState;
  icon: "circle-check" | "folder-check" | "layers-3" | "circle" | "triangle-alert";
  color: NoteOrganizerIndicatorColor;
  label: string;
  tooltip: string;
  ariaLabel: string;
  classNames: string[];
  preferredSurfaces: readonly ["editor-header", "status-bar"];
  interactive: true;
}

export interface NoteOrganizerMembershipSummary {
  path: string;
  currentBaseId: string;
  currentBase: NoteOrganizerBaseMembership | null;
  bases: NoteOrganizerBaseMembership[];
  currentBaseOrganized: boolean;
  currentBaseHasPrimary: boolean;
  currentBaseCollectionOnly: boolean;
  otherBaseCount: number;
  totalBaseCount: number;
  collectionOnlyBaseCount: number;
  brokenBaseCount: number;
  indicator: NoteOrganizerIndicatorModel;
}

export interface NoteOrganizerMembershipOptions {
  /** False marks persisted references as broken. It does not make an unreferenced path an error. */
  pathExists?: boolean;
  /**
   * Project persisted paths through an ordered, temporary vault-rename
   * overlay. This lets read-only membership surfaces describe the file that
   * already moved even while the durable all-base repair is still pending.
   */
  projectPath?: (path: string) => string;
}

function layoutContainsAny(
  node: LayoutHeading | LayoutSubheading,
  candidates: ReadonlySet<string>,
  projectPath: (path: string) => string,
): boolean {
  if (node.subjects.some((subject) => candidates.has(projectPath(subject)))) return true;
  return childSubheadings(node).some((child) => layoutContainsAny(child, candidates, projectPath));
}

function uniqueSorted(values: Iterable<string>): string[] {
  return [...new Set(values)].sort(codeUnitCompare);
}

function baseMembership(
  path: string,
  base: NoteOrganizerBaseProjection,
  currentBaseId: string,
  pathExists: boolean,
  projectPath: (path: string) => string,
): NoteOrganizerBaseMembership {
  const { data } = base;
  const direct = [...(data.directIndexPaths ?? []), ...(data.manualIndexPaths ?? [])]
    .some((storedPath) => projectPath(storedPath) === path);
  const hidden = (data.excludedIndexPaths ?? []).some((storedPath) => projectPath(storedPath) === path);
  const linkedSources = data.settings.workspaceMode === "generic"
    ? (data.indexFolderSources ?? [])
      .map((source) => ({ ...source, path: projectPath(source.path) }))
      .filter((source) => pathIsInIndexFolderSources(path, [source]))
    : [];
  const record = base.record && projectPath(base.record.path) === path ? base.record : null;
  const protectedSource = Boolean(
    data.settings.workspaceMode === "ent-clinical"
    && record
    && !record.isPlaceholder
    && record.kind === "topic"
    && (record.role === "canonical" || record.role === "supporting")
    && !hidden,
  );
  const subjectById = new Map(data.portableIndex.subjects.map((subject) => [subject.id, subject]));
  const ownerIds = uniqueSorted(Object.entries(data.portableIndex.resolvedPathBySubjectId)
    .filter(([, resolvedPath]) => projectPath(resolvedPath) === path)
    .map(([subjectId]) => subjectId));
  if (record?.portableId && !ownerIds.includes(record.portableId)) ownerIds.push(record.portableId);
  ownerIds.sort(codeUnitCompare);
  const owners = ownerIds.map((subjectId) => subjectById.get(subjectId)).filter((subject) => subject !== undefined);
  const missingOwnerIds = ownerIds.filter((subjectId) => !subjectById.has(subjectId));
  const collectionCandidates = new Set<string>([path]);
  for (const subjectId of ownerIds) collectionCandidates.add(portablePlaceholderPath(subjectId));
  const collectionTitles = uniqueSorted(data.collections
    .filter((heading) => layoutContainsAny(heading, collectionCandidates, projectPath))
    .map((heading) => heading.title));

  const provenance = new Set<NoteOrganizerMembershipProvenance>();
  if (direct) provenance.add("direct");
  if (linkedSources.length > 0) provenance.add("linked-folder");
  if (protectedSource) provenance.add("protected");
  if (ownerIds.length > 0 || record?.portableId) provenance.add("portable");

  const libraryById = new Map(data.portableIndex.libraries.map((library) => [library.id, library]));
  const libraryIds = new Set<string>();
  if (record?.libraryId) libraryIds.add(record.libraryId);
  for (const subject of owners) {
    if (!subject.indexed && subject.libraryId) libraryIds.add(subject.libraryId);
  }
  const issues: NoteOrganizerMembershipIssue[] = [];
  if (ownerIds.length > 1) issues.push({
    kind: "duplicate-portable-owner",
    detail: `This note has ${ownerIds.length.toLocaleString()} portable identities in ${base.name}.`,
  });
  for (const subjectId of missingOwnerIds) issues.push({
    kind: "missing-portable-subject",
    detail: `Portable identity “${subjectId}” no longer has a subject definition in ${base.name}.`,
  });
  for (const libraryId of libraryIds) {
    if (!libraryById.has(libraryId)) issues.push({
      kind: "unknown-library",
      detail: `Library “${libraryId}” is no longer available in ${base.name}.`,
    });
  }
  if (direct && hidden) issues.push({
    kind: "direct-and-hidden",
    detail: `This note is both directly included and hidden in ${base.name}.`,
  });

  const recordIndexed = Boolean(record && recordBelongsToIndex(record));
  const indexActive = direct || (linkedSources.length > 0 && !hidden) || protectedSource || recordIndexed;
  const validLibraryIds = [...libraryIds].filter((libraryId) => libraryById.has(libraryId));
  let primary: NoteOrganizerPrimaryPlacement;
  if ((indexActive && validLibraryIds.length > 0) || validLibraryIds.length > 1) {
    const labels = [
      ...(indexActive ? [data.settings.indexLabel] : []),
      ...validLibraryIds.map((libraryId) => libraryById.get(libraryId)?.name ?? libraryId),
    ];
    primary = { kind: "conflict", labels: uniqueSorted(labels) };
    issues.push({
      kind: "conflicting-primary-placement",
      detail: `This note has incompatible primary placements in ${base.name}.`,
    });
  } else if (validLibraryIds[0]) {
    const libraryId = validLibraryIds[0];
    primary = { kind: "library", libraryId, label: libraryById.get(libraryId)?.name ?? libraryId };
  } else if (indexActive) {
    primary = { kind: "index", label: data.settings.indexLabel };
  } else {
    primary = { kind: "none" };
  }
  const organized = primary.kind !== "none" || collectionTitles.length > 0;
  const hasReference = organized || hidden || ownerIds.length > 0;
  if (!pathExists && hasReference && !isPortablePlaceholderPath(path)) issues.push({
    kind: "missing-note",
    detail: `This organization references a Markdown note that is unavailable in ${base.name}.`,
  });
  return {
    baseId: base.baseId,
    baseName: base.name,
    current: base.baseId === currentBaseId,
    primary,
    collectionTitles,
    collectionOnly: primary.kind === "none" && collectionTitles.length > 0,
    organized,
    provenance: [...provenance],
    linkedSourcePaths: uniqueSorted(linkedSources.map((source) => source.path)),
    portableSubjectIds: ownerIds,
    hidden,
    hasReference,
    issues,
    broken: issues.length > 0,
  };
}

function countLabel(count: number, singular: string, plural = `${singular}s`): string {
  return `${count.toLocaleString()} ${count === 1 ? singular : plural}`;
}

export function buildNoteOrganizerIndicatorModel(
  input: Omit<NoteOrganizerMembershipSummary, "indicator">,
): NoteOrganizerIndicatorModel {
  const currentName = input.currentBase?.baseName || "the current knowledge base";
  let state: NoteOrganizerIndicatorState;
  let icon: NoteOrganizerIndicatorModel["icon"];
  let color: NoteOrganizerIndicatorColor;
  let label: string;
  let tooltip: string;
  if (input.brokenBaseCount > 0) {
    state = "broken";
    icon = "triangle-alert";
    color = "danger";
    label = `KBCC: ${countLabel(input.brokenBaseCount, "organization issue")}`;
    tooltip = `${label}. Review the affected knowledge-base memberships before making another organization change.`;
  } else if (input.currentBaseCollectionOnly) {
    state = "collection-only-current";
    icon = "folder-check";
    color = "success";
    label = `KBCC: In collections only in ${currentName}`;
    tooltip = `${label}. ${countLabel(input.totalBaseCount, "knowledge base", "knowledge bases")} organize this note in total.`;
  } else if (input.currentBaseOrganized) {
    state = "organized-current";
    icon = "circle-check";
    color = "success";
    label = `KBCC: Organized in ${currentName}`;
    tooltip = `${label}. ${countLabel(input.totalBaseCount, "knowledge base", "knowledge bases")} organize this note in total.`;
  } else if (input.otherBaseCount > 0) {
    state = "organized-other";
    icon = "layers-3";
    color = "accent";
    label = `KBCC: Organized in ${countLabel(input.otherBaseCount, "other knowledge base", "other knowledge bases")}`;
    tooltip = `${label}, but not in ${currentName}.`;
  } else {
    state = "not-organized";
    icon = "circle";
    color = "muted";
    label = "KBCC: Not organized";
    tooltip = "This note is not organized in any KBCC knowledge base. Its folder location alone does not add it.";
  }
  return {
    id: "kbcc-note-membership",
    state,
    icon,
    color,
    label,
    tooltip,
    ariaLabel: `${tooltip} Activate to review or change memberships.`,
    classNames: ["ent-cc-note-membership-indicator", `ent-cc-note-membership-${state}`],
    preferredSurfaces: ["editor-header", "status-bar"],
    interactive: true,
  };
}

/**
 * Summarize one real Markdown path without changing any base. Ordinary absence
 * is deliberately neutral; danger is reserved for persisted inconsistencies.
 */
export function summarizeNoteOrganizerMembership(
  path: string,
  bases: readonly NoteOrganizerBaseProjection[],
  currentBaseId: string,
  options: NoteOrganizerMembershipOptions = {},
): NoteOrganizerMembershipSummary {
  const projectPath = options.projectPath ?? ((storedPath: string): string => storedPath);
  const memberships = bases
    .map((base) => baseMembership(path, base, currentBaseId, options.pathExists ?? true, projectPath))
    .sort((left, right) => Number(right.current) - Number(left.current)
      || codeUnitCompare(left.baseName, right.baseName)
      || codeUnitCompare(left.baseId, right.baseId));
  const currentBase = memberships.find((base) => base.current) ?? null;
  const totalBaseCount = memberships.filter((base) => base.organized).length;
  const summaryWithoutIndicator: Omit<NoteOrganizerMembershipSummary, "indicator"> = {
    path,
    currentBaseId,
    currentBase,
    bases: memberships,
    currentBaseOrganized: currentBase?.organized ?? false,
    currentBaseHasPrimary: Boolean(currentBase && currentBase.primary.kind !== "none"),
    currentBaseCollectionOnly: currentBase?.collectionOnly ?? false,
    otherBaseCount: memberships.filter((base) => !base.current && base.organized).length,
    totalBaseCount,
    collectionOnlyBaseCount: memberships.filter((base) => base.collectionOnly).length,
    brokenBaseCount: memberships.filter((base) => base.broken).length,
  };
  return { ...summaryWithoutIndicator, indicator: buildNoteOrganizerIndicatorModel(summaryWithoutIndicator) };
}

export interface NoteOrganizerSelectedVaultItem {
  path: string;
  kind: "file" | "folder";
}

export interface NoteOrganizerVaultFile {
  path: string;
}

export interface NoteOrganizerSelectionOptions {
  /** Destination-aware policy supplied by the host. False positives are safer than silent inclusion. */
  isRestrictedPath: (path: string) => boolean;
  includeRestricted?: boolean;
  maxPaths?: number;
  maxCandidates?: number;
}

export interface NoteOrganizerSelectionSkips {
  invalid: number;
  nonMarkdown: number;
  restricted: number;
  missing: number;
  duplicate: number;
}

export type NoteOrganizerSelectionKind = "single-note" | "multiple-notes" | "folder-snapshot" | "mixed-snapshot";

export interface NoteOrganizerSelectionSnapshot {
  paths: string[];
  kind: NoteOrganizerSelectionKind;
  sourceFileCount: number;
  sourceFolderCount: number;
  skips: NoteOrganizerSelectionSkips;
  complete: boolean;
  blockedReason: "selection-limit" | "candidate-limit" | null;
  /** A folder is expanded once against the supplied inventory; this is never a live folder rule. */
  folderSnapshot: boolean;
}

function hasControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 31 || code === 127) return true;
  }
  return false;
}

function normalizedVaultPath(value: string, allowRoot = false): string | null {
  if (typeof value !== "string" || value.length > MAX_TRANSFER_TEXT_LENGTH || hasControlCharacter(value)) return null;
  const replaced = value.replace(/\u00A0|\u202F/gu, " ").replace(/\\/gu, "/").replace(/\/{2,}/gu, "/");
  if (/^\/+$/u.test(replaced)) return allowRoot ? "" : null;
  if (replaced.startsWith("/")) return null;
  const clean = replaced.replace(/^\/+|\/+$/gu, "").normalize("NFC");
  if (!clean) return allowRoot ? "" : null;
  if (clean.startsWith("~") || /^[a-z]:\//iu.test(clean)) return null;
  const parts = clean.split("/");
  if (parts.some((part) => part === "." || part === ".." || !part)) return null;
  return clean;
}

export function normalizeNoteOrganizerVaultPath(value: string): string | null {
  return normalizedVaultPath(value);
}

function isMarkdownPath(path: string): boolean {
  return path.toLowerCase().endsWith(".md");
}

function withinFolder(path: string, folder: string): boolean {
  return folder === "" || path.startsWith(`${folder}/`);
}

/** Resolve files and folders into an immutable, deterministic, one-time path snapshot. */
export function normalizeNoteOrganizerSelection(
  selectedItems: readonly NoteOrganizerSelectedVaultItem[],
  vaultFiles: readonly NoteOrganizerVaultFile[],
  options: NoteOrganizerSelectionOptions,
): NoteOrganizerSelectionSnapshot {
  const maxPaths = Math.max(1, Math.min(options.maxPaths ?? MAX_NOTE_ORGANIZER_SELECTION_PATHS, MAX_NOTE_ORGANIZER_SELECTION_PATHS));
  const maxCandidates = Math.max(1, Math.min(options.maxCandidates ?? MAX_NOTE_ORGANIZER_SELECTION_CANDIDATES, MAX_NOTE_ORGANIZER_SELECTION_CANDIDATES));
  const skips: NoteOrganizerSelectionSkips = { invalid: 0, nonMarkdown: 0, restricted: 0, missing: 0, duplicate: 0 };
  const selectedFiles = new Set<string>();
  const selectedFolders = new Set<string>();
  let sourceFileCount = 0;
  let sourceFolderCount = 0;
  for (const item of selectedItems) {
    if (item.kind === "folder") {
      sourceFolderCount += 1;
      const path = normalizedVaultPath(item.path, true);
      if (path === null) skips.invalid += 1;
      else if (selectedFolders.has(path)) skips.duplicate += 1;
      else selectedFolders.add(path);
      continue;
    }
    sourceFileCount += 1;
    const path = normalizedVaultPath(item.path);
    if (!path) skips.invalid += 1;
    else if (!isMarkdownPath(path)) skips.nonMarkdown += 1;
    else if (selectedFiles.has(path)) skips.duplicate += 1;
    else selectedFiles.add(path);
  }
  const kind: NoteOrganizerSelectionKind = sourceFolderCount > 0
    ? sourceFileCount > 0 ? "mixed-snapshot" : "folder-snapshot"
    : sourceFileCount === 1 ? "single-note" : "multiple-notes";
  if (vaultFiles.length > maxCandidates) return {
    paths: [], kind, sourceFileCount, sourceFolderCount, skips,
    complete: false, blockedReason: "candidate-limit", folderSnapshot: sourceFolderCount > 0,
  };
  const inventory = new Map<string, string>();
  for (const file of vaultFiles) {
    const path = normalizedVaultPath(file.path);
    if (!path || !isMarkdownPath(path)) continue;
    inventory.set(path, path);
  }
  for (const path of selectedFiles) {
    if (!inventory.has(path)) skips.missing += 1;
  }
  const folderRoots = [...selectedFolders];
  const matching = [...inventory.keys()]
    .filter((path) => selectedFiles.has(path) || folderRoots.some((folder) => withinFolder(path, folder)))
    .sort(codeUnitCompare);
  const paths: string[] = [];
  for (const path of matching) {
    if (!options.includeRestricted && options.isRestrictedPath(path)) {
      skips.restricted += 1;
      continue;
    }
    paths.push(path);
    if (paths.length > maxPaths) return {
      paths: [], kind, sourceFileCount, sourceFolderCount, skips,
      complete: false, blockedReason: "selection-limit", folderSnapshot: sourceFolderCount > 0,
    };
  }
  return {
    paths, kind, sourceFileCount, sourceFolderCount, skips,
    complete: true, blockedReason: null, folderSnapshot: sourceFolderCount > 0,
  };
}

export interface NoteOrganizerDataTransferLike {
  readonly types: readonly string[];
  readonly files?: { readonly length: number };
  getData(type: string): string;
}

export interface NoteOrganizerDropOptions {
  /** Additional documented string MIME types may be enabled by the host; object payloads remain unsupported. */
  allowedMimeTypes?: readonly string[];
  maxPaths?: number;
  maxTextLength?: number;
}

export type NoteOrganizerDropRejectReason =
  | "filesystem-payload"
  | "oversized-payload"
  | "unsupported-payload"
  | "unsafe-path"
  | "path-limit";

export interface NoteOrganizerDropParseResult {
  paths: string[];
  acceptedMimeTypes: string[];
  rejectedReasons: NoteOrganizerDropRejectReason[];
  complete: boolean;
  /** True means the host must not resolve or preview any returned paths. */
  blocked: boolean;
}

function hasUriScheme(value: string): boolean {
  return /^[a-z][a-z0-9+.-]*:/iu.test(value);
}

function decodeObsidianUri(value: string): string | null {
  let uri: URL;
  try {
    uri = new URL(value);
  } catch {
    return null;
  }
  if (uri.protocol.toLowerCase() !== "obsidian:" || uri.hostname.toLowerCase() !== "open") return null;
  // A vault-qualified link expresses an intent for a specific, possibly
  // different vault. Without an exact current-vault name supplied by the
  // host, fail closed instead of resolving the same relative path here.
  if (uri.searchParams.has("vault")) return null;
  const file = uri.searchParams.get("file");
  if (!file || hasUriScheme(file)) return null;
  const normalized = normalizedVaultPath(file);
  if (!normalized) return null;
  return isMarkdownPath(normalized) ? normalized : `${normalized}.md`;
}

function pathFromDropLine(value: string): string | null {
  const line = value.trim();
  if (!line || line.startsWith("#")) return null;
  if (/^file:/iu.test(line) || /^[/~]/u.test(line) || /^[a-z]:[\\/]/iu.test(line)) return null;
  if (/^obsidian:/iu.test(line)) return decodeObsidianUri(line);
  if (hasUriScheme(line)) return null;
  const wiki = /^\[\[([^\]]+)\]\]$/u.exec(line);
  if (wiki?.[1]) {
    const target = (wiki[1].split("|")[0] ?? "").split("#")[0] ?? "";
    if (hasUriScheme(target)) return null;
    const normalized = normalizedVaultPath(target);
    if (!normalized) return null;
    return isMarkdownPath(normalized) ? normalized : `${normalized}.md`;
  }
  const normalized = normalizedVaultPath(line);
  return normalized && isMarkdownPath(normalized) ? normalized : null;
}

/**
 * Parse only allowlisted DataTransfer strings. Returned paths are untrusted
 * candidates: the host must resolve them to current vault files before review.
 */
export function parseNoteOrganizerDrop(
  dataTransfer: NoteOrganizerDataTransferLike,
  options: NoteOrganizerDropOptions = {},
): NoteOrganizerDropParseResult {
  const maxPaths = Math.max(1, Math.min(options.maxPaths ?? MAX_NOTE_ORGANIZER_DROP_PATHS, MAX_NOTE_ORGANIZER_DROP_PATHS));
  const maxTextLength = Math.max(1, Math.min(options.maxTextLength ?? MAX_NOTE_ORGANIZER_DROP_TEXT_LENGTH, MAX_NOTE_ORGANIZER_DROP_TEXT_LENGTH));
  const types = new Map(dataTransfer.types.map((type) => [type.toLowerCase(), type]));
  if ((dataTransfer.files?.length ?? 0) > 0 || types.has("files")) return {
    paths: [], acceptedMimeTypes: [], rejectedReasons: ["filesystem-payload"], complete: false, blocked: true,
  };
  const allowed = uniqueSorted(["text/plain", "text/uri-list", ...(options.allowedMimeTypes ?? []).map((type) => type.toLowerCase())]);
  const acceptedMimeTypes: string[] = [];
  const rejectedReasons = new Set<NoteOrganizerDropRejectReason>();
  const paths = new Set<string>();
  let foundPayload = false;
  for (const mime of allowed) {
    const originalType = types.get(mime);
    if (!originalType) continue;
    let payload = "";
    try {
      payload = dataTransfer.getData(originalType);
    } catch {
      rejectedReasons.add("unsupported-payload");
      continue;
    }
    if (!payload) continue;
    foundPayload = true;
    if (payload.length > maxTextLength) {
      rejectedReasons.add("oversized-payload");
      continue;
    }
    acceptedMimeTypes.push(mime);
    for (const line of payload.split(/\r?\n/gu)) {
      if (!line.trim() || (mime === "text/uri-list" && line.trim().startsWith("#"))) continue;
      const path = pathFromDropLine(line);
      if (!path) {
        rejectedReasons.add("unsafe-path");
        continue;
      }
      paths.add(path);
      if (paths.size > maxPaths) return {
        paths: [], acceptedMimeTypes: uniqueSorted(acceptedMimeTypes),
        rejectedReasons: uniqueSorted([...rejectedReasons, "path-limit"]) as NoteOrganizerDropRejectReason[],
        complete: false, blocked: true,
      };
    }
  }
  if (!foundPayload) rejectedReasons.add("unsupported-payload");
  const blocked = rejectedReasons.size > 0;
  return {
    paths: blocked ? [] : uniqueSorted(paths),
    acceptedMimeTypes: uniqueSorted(acceptedMimeTypes),
    rejectedReasons: uniqueSorted(rejectedReasons) as NoteOrganizerDropRejectReason[],
    complete: !blocked,
    blocked,
  };
}

export type NoteOrganizerMenuActionId = "organize" | "show-memberships";

export interface NoteOrganizerContextMenuAction {
  id: NoteOrganizerMenuActionId;
  title: string;
  ariaLabel: string;
  icon: "network" | "list-tree";
  enabled: boolean;
  opensReview: boolean;
}

export interface NoteOrganizerContextMenuDescriptor {
  kind: NoteOrganizerSelectionKind;
  noteCount: number;
  actions: NoteOrganizerContextMenuAction[];
}

/** Build labels only; registering or executing an Obsidian menu stays with the host. */
export function buildNoteOrganizerContextMenuDescriptor(
  snapshot: NoteOrganizerSelectionSnapshot,
): NoteOrganizerContextMenuDescriptor {
  const noteCount = snapshot.paths.length;
  const folder = snapshot.folderSnapshot;
  const organizeTitle = folder
    ? noteCount === 1
      ? "Organize current Markdown note in KBCC…"
      : `Organize ${noteCount.toLocaleString()} current Markdown notes in KBCC…`
    : noteCount === 1
      ? "Organize in KBCC…"
      : `Organize ${noteCount.toLocaleString()} notes in KBCC…`;
  const enabled = snapshot.complete && noteCount > 0;
  const actions: NoteOrganizerContextMenuAction[] = [{
    id: "organize",
    title: organizeTitle,
    ariaLabel: `${organizeTitle.replace(/…$/u, "")}. Opens a review; Markdown files will not move or change.`,
    icon: "network",
    enabled,
    opensReview: true,
  }];
  if (snapshot.kind === "single-note" && noteCount === 1) actions.push({
    id: "show-memberships",
    title: "Show KBCC memberships",
    ariaLabel: "Show this note’s memberships across all KBCC knowledge bases.",
    icon: "list-tree",
    enabled: true,
    opensReview: false,
  });
  return { kind: snapshot.kind, noteCount, actions };
}

/** Adapter contract implemented by editor-header or status-bar UI code. */
export interface NoteOrganizerIndicatorHost {
  show(model: Readonly<NoteOrganizerIndicatorModel>, onActivate: () => void): void;
  remove(): void;
}

export interface NoteOrganizerIndicatorController {
  update(summary: NoteOrganizerMembershipSummary | null): void;
  destroy(): void;
}

/** Keep workspace events and DOM ownership out of the membership projection. */
export function createNoteOrganizerIndicatorController(
  host: NoteOrganizerIndicatorHost,
  onActivate: () => void,
): NoteOrganizerIndicatorController {
  let destroyed = false;
  return {
    update(summary): void {
      if (destroyed) return;
      if (summary) host.show(summary.indicator, onActivate);
      else host.remove();
    },
    destroy(): void {
      if (destroyed) return;
      destroyed = true;
      host.remove();
    },
  };
}
