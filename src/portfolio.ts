import {
  boundedSemanticLineage,
  canonicalJsonString,
  childSubheadings,
  createKnowledgeBaseEntry,
  createPersonalBackup,
  DEFAULT_DATA,
  DEFAULT_SETTINGS,
  deterministicSemanticHead,
  ENT_CLINICAL_SETTINGS,
  fingerprintText,
  isSafeObjectKey,
  limitSnapshotStack,
  MAX_KNOWLEDGE_BASES,
  MAX_TRANSFER_TOTAL_REFERENCES,
  normalizedNameKey,
  normalizeKnowledgeBaseLibrariesAndNavigation,
  semanticEntryFingerprint,
  snapshotPersonal,
  subjectLibraryId,
  validateProposalFolderPath,
  validateTemplateFilePath,
  validateWritableFolderPath,
  type KnowledgeBaseEntry,
  type LayoutHeading,
  type LayoutSubheading,
  type PersonalBackup,
  type PluginData,
  type PluginStore,
  type VaultRecord,
  type WorkspaceMode,
} from "./model";
import {
  applyPortableExport,
  assertPortableImportDestinationCompatible,
  createPortableExport,
  EMPTY_PORTABLE_SELECTION,
  normalizePortableSelection,
  parsePortableExport,
  PORTABLE_EXPORT_VERSION,
  portableSelectionHasAny,
  selectionAvailableForExport,
  serializePortableExport,
  synchronizePortableRegistry,
  type PortableCollectionSubheadingV1,
  type PortableCollectionV1,
  type PortableExportSelection,
  type PortableExportV1,
  type PortableImportMode,
  type PortableImportResult,
} from "./portability";

export const PORTFOLIO_EXPORT_KIND = "knowledge-base-command-center-portfolio-export" as const;
export const PORTFOLIO_EXPORT_VERSION = 1 as const;
export const MAX_PORTFOLIO_BUNDLE_BYTES = 32 * 1024 * 1024;
export const MAX_PORTFOLIO_TOTAL_SUBJECTS = 100_000;
export const MAX_PORTFOLIO_TOTAL_STRUCTURES = 20_000;
export const MAX_PORTFOLIO_TOTAL_REFERENCES = MAX_TRANSFER_TOTAL_REFERENCES;

const utf8Encoder = new TextEncoder();

export interface PortfolioManifestEntry {
  sourceBaseId: string;
  sourceBaseName: string;
  sourceWorkspaceMode: WorkspaceMode;
  selection: PortableExportSelection;
  packageBytes: number;
  subjects: number;
  structures: number;
  references: number;
  /** True only when the package selected every active source Library. */
  completeLibrarySet: boolean;
}

export interface PortfolioManifest {
  baseCount: number;
  totalPackageBytes: number;
  totalSubjects: number;
  totalStructures: number;
  totalReferences: number;
  entries: PortfolioManifestEntry[];
}

export interface PortfolioPackageEntry {
  sourceBaseId: string;
  package: PortableExportV1;
}

export interface PortfolioExportV1 {
  kind: typeof PORTFOLIO_EXPORT_KIND;
  version: typeof PORTFOLIO_EXPORT_VERSION;
  exportedAt: string;
  sourceVaultId: string;
  privacy: "portable-no-note-content";
  manifest: PortfolioManifest;
  packages: PortfolioPackageEntry[];
}

export interface PortfolioExportRequest {
  entry: KnowledgeBaseEntry;
  records: VaultRecord[];
  selection: PortableExportSelection;
  /** Distinguishes an explicitly selected empty Library set from omission. */
  completeLibrarySet?: boolean;
}

export type PortfolioDestination =
  | { kind: "new"; name?: string }
  | { kind: "existing"; baseId: string };

export interface PortfolioImportMapping {
  sourceBaseId: string;
  destination: PortfolioDestination;
  mode: PortableImportMode;
  /** Omitted means every component present in this source package. */
  selection?: PortableExportSelection;
}

export interface PortfolioResourceResolver {
  configDir: string;
  folderExists?: (path: string) => boolean;
  templateExists?: (path: string) => boolean;
}

export interface PortfolioImportPlanOptions {
  allowCrossVaultReplace?: boolean;
  expectedExternalGeneration?: number;
  now?: number;
  resources?: PortfolioResourceResolver;
  recordsByBaseId?: ReadonlyMap<string, readonly VaultRecord[]>;
}

export interface PortfolioPlanDiff {
  basesAdd: string[];
  basesReplace: string[];
  headingsAdd: string[];
  headingsRename: string[];
  headingsRemove: string[];
  subjectsAdd: string[];
  subjectsMove: string[];
  subjectsUnplaced: string[];
  librariesAdd: string[];
  librariesArchive: string[];
  conflicts: string[];
  fallbacks: string[];
  willNotChange: string[];
}

export interface PortfolioPlanOperation {
  sourceBaseId: string;
  sourceBaseName: string;
  destinationKind: PortfolioDestination["kind"];
  destinationBaseId: string;
  destinationBaseName: string;
  mode: PortableImportMode;
  selection: PortableExportSelection;
  beforeEntryGuard: string;
  afterEntry: KnowledgeBaseEntry;
  result: PortableImportResult;
  diff: PortfolioPlanDiff;
}

export interface PortfolioRecoveryPackage {
  destinationBaseId: string;
  destinationBaseName: string;
  package: PortableExportV1;
}

export interface PortfolioImportPlan {
  kind: "knowledge-base-command-center-portfolio-import-plan";
  version: 1;
  id: string;
  createdAt: number;
  sourceVaultId: string;
  expectedStoreGuard: string;
  expectedAfterStoreGuard: string;
  expectedActiveBaseId: string;
  expectedExternalGeneration: number;
  crossVault: boolean;
  confirmationPhrase: string;
  operations: PortfolioPlanOperation[];
  recoveryPackages: PortfolioRecoveryPackage[];
  diff: PortfolioPlanDiff;
  planGuard: string;
}

function plainRecord(input: unknown, label: string): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error(`${label} must be an object.`);
  return input as Record<string, unknown>;
}

function safeStableId(input: unknown, label: string): string {
  if (typeof input !== "string") throw new Error(`${label} must be text.`);
  const id = input.trim();
  if (!id || id.length > 128 || !/^[a-z0-9][a-z0-9._:@+-]*$/iu.test(id) || !isSafeObjectKey(id)) {
    throw new Error(`${label} has an invalid stable ID.`);
  }
  return id;
}

function safeName(input: unknown, label: string): string {
  if (typeof input !== "string") throw new Error(`${label} must be text.`);
  const name = input.trim().normalize("NFC");
  if (!name || name.length > 100 || /[\p{Cc}\p{Cf}]/u.test(name)) throw new Error(`${label} is invalid.`);
  return name;
}

function safeVaultId(input: unknown): string {
  return safeStableId(input, "Source vault");
}

function safeNonNegativeInteger(input: unknown, label: string): number {
  if (typeof input !== "number" || !Number.isSafeInteger(input) || input < 0) {
    throw new Error(`${label} must be a non-negative integer.`);
  }
  return input;
}

function fingerprint(value: unknown): string {
  return fingerprintText(typeof value === "string" ? value : canonicalJsonString(value));
}

function byteLength(value: string): number {
  return utf8Encoder.encode(value).byteLength;
}

export function selectionUsesSubjects(selection: PortableExportSelection): boolean {
  const normalized = normalizePortableSelection(selection);
  return normalized.index
    || (normalized.libraryIds?.length ?? 0) > 0
    || normalized.collections
    || normalized.study;
}

function strictSelection(input: unknown, label: string): PortableExportSelection {
  const value = plainRecord(input, label);
  for (const key of ["workspace", "index", "collections", "study", "savedViews", "recovery"] as const) {
    if (typeof value[key] !== "boolean") throw new Error(`${label}.${key} must be true or false.`);
  }
  if (!Array.isArray(value.libraryIds)) throw new Error(`${label}.libraryIds must be a list.`);
  if (value.libraryIds.length > 50) throw new Error(`${label}.libraryIds has too many entries.`);
  const libraryIds = value.libraryIds.map((id, index) => safeStableId(id, `${label} library ${index + 1}`));
  if (new Set(libraryIds).size !== libraryIds.length) throw new Error(`${label}.libraryIds contains a duplicate.`);
  const selection = normalizePortableSelection({
    ...EMPTY_PORTABLE_SELECTION,
    workspace: value.workspace as boolean,
    index: value.index as boolean,
    libraryIds,
    collections: value.collections as boolean,
    study: value.study as boolean,
    savedViews: value.savedViews as boolean,
    recovery: value.recovery as boolean,
  });
  if (selection.recovery) throw new Error("Portfolio transfer packages cannot contain private same-vault recovery data.");
  if (!portableSelectionHasAny(selection)) throw new Error(`${label} selects no components.`);
  return selection;
}

function normalizedSelectionForManifest(selection: PortableExportSelection): PortableExportSelection {
  const normalized = normalizePortableSelection(selection);
  return {
    workspace: normalized.workspace,
    index: normalized.index,
    libraryIds: [...normalized.libraryIds],
    collections: normalized.collections,
    study: normalized.study,
    savedViews: normalized.savedViews,
    recovery: false,
  };
}

function selectionsEqual(left: PortableExportSelection, right: PortableExportSelection): boolean {
  const normalize = (selection: PortableExportSelection): unknown => {
    const value = normalizePortableSelection(selection);
    return {
      workspace: value.workspace,
      index: value.index,
      libraryIds: [...value.libraryIds].sort(),
      collections: value.collections,
      study: value.study,
      savedViews: value.savedViews,
      recovery: value.recovery,
    };
  };
  return canonicalJsonString(normalize(left)) === canonicalJsonString(normalize(right));
}

interface PackageBudget {
  subjects: number;
  structures: number;
  references: number;
}

function packageBudget(value: PortableExportV1): PackageBudget {
  const index = value.components.index;
  let structures = (index?.groups.length ?? 0) + (index?.libraries?.length ?? 0);
  let references = 0;
  const chargeLayoutNodes = (nodes: readonly (LayoutHeading | LayoutSubheading)[]): void => {
    for (const node of nodes) {
      structures += 1;
      references += node.subjects.length;
      chargeLayoutNodes(childSubheadings(node));
    }
  };
  for (const layout of Object.values(index?.libraryLayouts ?? {})) chargeLayoutNodes(layout);
  const chargeCollectionNode = (node: PortableCollectionV1 | PortableCollectionSubheadingV1): void => {
    structures += 1;
    references += node.subjectIds.length;
    for (const child of node.subheadings ?? []) chargeCollectionNode(child);
  };
  for (const collection of value.components.collections?.collections ?? []) chargeCollectionNode(collection);
  references += value.components.study?.pinnedSubjectIds.length ?? 0;
  references += value.components.study?.nextSubjectIds.length ?? 0;
  structures += value.components.savedViews?.views.length ?? 0;
  return { subjects: index?.subjects.length ?? 0, structures, references };
}

function assertAggregateBudget(manifest: PortfolioManifest): void {
  if (manifest.baseCount < 1 || manifest.baseCount > MAX_KNOWLEDGE_BASES) {
    throw new Error(`A portfolio must contain between 1 and ${MAX_KNOWLEDGE_BASES} knowledge bases.`);
  }
  if (manifest.totalPackageBytes > MAX_PORTFOLIO_BUNDLE_BYTES) {
    throw new Error("The portfolio's aggregate portable packages exceed the 32 MB safety limit.");
  }
  if (manifest.totalSubjects > MAX_PORTFOLIO_TOTAL_SUBJECTS) {
    throw new Error(`The portfolio contains more than ${MAX_PORTFOLIO_TOTAL_SUBJECTS.toLocaleString()} subjects.`);
  }
  if (manifest.totalStructures > MAX_PORTFOLIO_TOTAL_STRUCTURES) {
    throw new Error(`The portfolio contains more than ${MAX_PORTFOLIO_TOTAL_STRUCTURES.toLocaleString()} headings, Libraries, Collections, and saved views.`);
  }
  if (manifest.totalReferences > MAX_PORTFOLIO_TOTAL_REFERENCES) {
    throw new Error(`The portfolio contains more than ${MAX_PORTFOLIO_TOTAL_REFERENCES.toLocaleString()} subject references.`);
  }
}

export function createPortfolioExport(
  requests: readonly PortfolioExportRequest[],
  exportedAt: string,
  sourceVaultId: string,
): PortfolioExportV1 {
  if (requests.length < 1 || requests.length > MAX_KNOWLEDGE_BASES) {
    throw new Error(`Choose between 1 and ${MAX_KNOWLEDGE_BASES} knowledge bases for a portfolio export.`);
  }
  const vaultId = safeVaultId(sourceVaultId);
  const ids = new Set<string>();
  const entries: PortfolioManifestEntry[] = [];
  const packages: PortfolioPackageEntry[] = [];
  for (const request of requests) {
    const sourceBaseId = safeStableId(request.entry.id, "Source knowledge base");
    if (ids.has(sourceBaseId)) throw new Error(`Knowledge base ${sourceBaseId} was selected more than once.`);
    ids.add(sourceBaseId);
    if (request.entry.archivedAt !== null) throw new Error(`Restore “${request.entry.data.settings.workspaceName}” before exporting it.`);
    const selection = normalizedSelectionForManifest(request.selection);
    if (selection.recovery) throw new Error("Portfolio exports cannot include private same-vault recovery data.");
    if (!portableSelectionHasAny(selection)) throw new Error(`Choose at least one component for “${request.entry.data.settings.workspaceName}”.`);
    const isolated = structuredClone(request.entry.data);
    const portable = createPortableExport(
      isolated,
      selectionUsesSubjects(selection) ? request.records : [],
      selection,
      exportedAt,
      vaultId,
      sourceBaseId,
      request.entry.data.settings.workspaceName,
    );
    const parsed = parsePortableExport(JSON.parse(serializePortableExport(portable)) as unknown);
    // The bundle carries the parsed package, and parsing NFC-normalizes every
    // title, so a decomposed name shrinks between the draft and what is
    // written. Measure the parsed form: the manifest has to declare the bytes
    // the importer will re-derive, not the bytes of the pre-normalization draft.
    const packageBytes = byteLength(serializePortableExport(parsed));
    const budget = packageBudget(parsed);
    const selectedLibraryIds = selection.libraryIds ?? [];
    entries.push({
      sourceBaseId,
      sourceBaseName: safeName(request.entry.data.settings.workspaceName, "Source knowledge-base name"),
      sourceWorkspaceMode: request.entry.data.settings.workspaceMode,
      selection,
      packageBytes,
      completeLibrarySet: request.completeLibrarySet ?? (
        new Set(selectedLibraryIds).size === request.entry.data.portableIndex.libraries
          .filter((library) => library.archivedAt === null).length
          && request.entry.data.portableIndex.libraries
            .filter((library) => library.archivedAt === null)
            .every((library) => selectedLibraryIds.includes(library.id))
      ),
      ...budget,
    });
    packages.push({ sourceBaseId, package: parsed });
  }
  const manifest: PortfolioManifest = {
    baseCount: entries.length,
    totalPackageBytes: entries.reduce((sum, entry) => sum + entry.packageBytes, 0),
    totalSubjects: entries.reduce((sum, entry) => sum + entry.subjects, 0),
    totalStructures: entries.reduce((sum, entry) => sum + entry.structures, 0),
    totalReferences: entries.reduce((sum, entry) => sum + entry.references, 0),
    entries,
  };
  assertAggregateBudget(manifest);
  const bundle: PortfolioExportV1 = {
    kind: PORTFOLIO_EXPORT_KIND,
    version: PORTFOLIO_EXPORT_VERSION,
    exportedAt,
    sourceVaultId: vaultId,
    privacy: "portable-no-note-content",
    manifest,
    packages,
  };
  // Validate the same representation that will be written or downloaded.
  return parsePortfolioExport(JSON.parse(serializePortfolioExportUnchecked(bundle)) as unknown);
}

function serializePortfolioExportUnchecked(value: PortfolioExportV1): string {
  const serialized = `${JSON.stringify(value, null, 2)}\n`;
  if (byteLength(serialized) > MAX_PORTFOLIO_BUNDLE_BYTES) {
    throw new Error("The portfolio export exceeds the 32 MB bundle limit. Export fewer bases or components.");
  }
  return serialized;
}

export function serializePortfolioExport(value: PortfolioExportV1): string {
  const serialized = serializePortfolioExportUnchecked(value);
  parsePortfolioExport(JSON.parse(serialized) as unknown);
  return serialized;
}

export function parsePortfolioExport(input: unknown): PortfolioExportV1 {
  let rawSize = 0;
  try {
    rawSize = byteLength(JSON.stringify(input));
  } catch {
    throw new Error("The selected portfolio is not valid JSON data.");
  }
  if (rawSize > MAX_PORTFOLIO_BUNDLE_BYTES) throw new Error("The selected portfolio is larger than the 32 MB import limit.");
  const value = plainRecord(input, "Portfolio export");
  if (value.kind !== PORTFOLIO_EXPORT_KIND || value.version !== PORTFOLIO_EXPORT_VERSION) {
    throw new Error("Unsupported Command Center portfolio export.");
  }
  if (value.privacy !== "portable-no-note-content") throw new Error("The portfolio is missing its no-note-content privacy declaration.");
  const sourceVaultId = safeVaultId(value.sourceVaultId);
  const rawManifest = plainRecord(value.manifest, "Portfolio manifest");
  if (!Array.isArray(rawManifest.entries) || !Array.isArray(value.packages)) {
    throw new Error("The portfolio manifest or package list is missing.");
  }
  const baseCount = safeNonNegativeInteger(rawManifest.baseCount, "Portfolio base count");
  if (baseCount !== rawManifest.entries.length || baseCount !== value.packages.length) {
    throw new Error("The portfolio manifest base count does not match its packages.");
  }
  if (baseCount < 1 || baseCount > MAX_KNOWLEDGE_BASES) {
    throw new Error(`A portfolio can contain at most ${MAX_KNOWLEDGE_BASES} knowledge bases.`);
  }
  const rawPackagesById = new Map<string, unknown>();
  for (const [index, raw] of value.packages.entries()) {
    const packageEntry = plainRecord(raw, `Portfolio package ${index + 1}`);
    const sourceBaseId = safeStableId(packageEntry.sourceBaseId, `Portfolio package ${index + 1} source base`);
    if (rawPackagesById.has(sourceBaseId)) throw new Error(`Duplicate portfolio package for ${sourceBaseId}.`);
    rawPackagesById.set(sourceBaseId, packageEntry.package);
  }
  const ids = new Set<string>();
  const entries: PortfolioManifestEntry[] = [];
  const packages: PortfolioPackageEntry[] = [];
  for (const [index, raw] of rawManifest.entries.entries()) {
    const manifestEntry = plainRecord(raw, `Portfolio manifest entry ${index + 1}`);
    const sourceBaseId = safeStableId(manifestEntry.sourceBaseId, `Portfolio manifest entry ${index + 1} source base`);
    if (ids.has(sourceBaseId)) throw new Error(`Duplicate portfolio manifest entry for ${sourceBaseId}.`);
    ids.add(sourceBaseId);
    const rawPackage = rawPackagesById.get(sourceBaseId);
    if (rawPackage === undefined) throw new Error(`Portfolio package ${sourceBaseId} is missing.`);
    // Deliberately delegate the complete inner format to the existing strict
    // portable parser. The portfolio layer never reimplements that schema.
    const portable = parsePortableExport(rawPackage);
    const available = selectionAvailableForExport(portable);
    const selection = strictSelection(manifestEntry.selection, `Portfolio manifest entry ${sourceBaseId} selection`);
    if (!selectionsEqual(selection, available)) {
      throw new Error(`Portfolio package ${sourceBaseId} does not match its declared component selection.`);
    }
    if (portable.components.recovery) throw new Error("Portfolio transfer packages cannot contain private same-vault recovery data.");
    const serializedPackage = serializePortableExport(portable);
    const actualBytes = byteLength(serializedPackage);
    const budget = packageBudget(portable);
    const declared: PackageBudget & { packageBytes: number } = {
      packageBytes: safeNonNegativeInteger(manifestEntry.packageBytes, `Portfolio package ${sourceBaseId} byte count`),
      subjects: safeNonNegativeInteger(manifestEntry.subjects, `Portfolio package ${sourceBaseId} subject count`),
      structures: safeNonNegativeInteger(manifestEntry.structures, `Portfolio package ${sourceBaseId} structure count`),
      references: safeNonNegativeInteger(manifestEntry.references, `Portfolio package ${sourceBaseId} reference count`),
    };
    if (typeof manifestEntry.completeLibrarySet !== "boolean") {
      throw new Error(`Portfolio package ${sourceBaseId} must declare whether it contains the complete active Library set.`);
    }
    if (declared.packageBytes !== actualBytes
      || declared.subjects !== budget.subjects
      || declared.structures !== budget.structures
      || declared.references !== budget.references) {
      throw new Error(`Portfolio package ${sourceBaseId} does not match its declared resource counts.`);
    }
    const sourceWorkspaceMode = manifestEntry.sourceWorkspaceMode;
    if (sourceWorkspaceMode !== "generic" && sourceWorkspaceMode !== "ent-clinical") {
      throw new Error(`Portfolio package ${sourceBaseId} has an unsupported preset.`);
    }
    const sourceBaseName = safeName(manifestEntry.sourceBaseName, `Portfolio package ${sourceBaseId} name`);
    const packageMode = portable.components.workspace?.settings.workspaceMode;
    if (packageMode && packageMode !== sourceWorkspaceMode) {
      throw new Error(`Portfolio package ${sourceBaseId} preset conflicts with its manifest.`);
    }
    if (portable.sourceWorkspace && portable.sourceWorkspace !== sourceBaseName) {
      throw new Error(`Portfolio package ${sourceBaseId} name conflicts with its manifest.`);
    }
    entries.push({
      sourceBaseId,
      sourceBaseName,
      sourceWorkspaceMode,
      selection,
      packageBytes: actualBytes,
      completeLibrarySet: manifestEntry.completeLibrarySet,
      ...budget,
    });
    packages.push({ sourceBaseId, package: portable });
  }
  if (rawPackagesById.size !== ids.size) throw new Error("The portfolio contains an unlisted package.");
  const manifest: PortfolioManifest = {
    baseCount,
    totalPackageBytes: entries.reduce((sum, entry) => sum + entry.packageBytes, 0),
    totalSubjects: entries.reduce((sum, entry) => sum + entry.subjects, 0),
    totalStructures: entries.reduce((sum, entry) => sum + entry.structures, 0),
    totalReferences: entries.reduce((sum, entry) => sum + entry.references, 0),
    entries,
  };
  for (const key of ["totalPackageBytes", "totalSubjects", "totalStructures", "totalReferences"] as const) {
    const declared = safeNonNegativeInteger(rawManifest[key], `Portfolio manifest ${key}`);
    if (declared !== manifest[key]) throw new Error(`Portfolio manifest ${key} does not match its packages.`);
  }
  assertAggregateBudget(manifest);
  return {
    kind: PORTFOLIO_EXPORT_KIND,
    version: PORTFOLIO_EXPORT_VERSION,
    exportedAt: typeof value.exportedAt === "string" ? value.exportedAt : "",
    sourceVaultId,
    privacy: "portable-no-note-content",
    manifest,
    packages,
  };
}

function storeGuard(store: PluginStore): string {
  return fingerprint({
    kind: store.kind,
    version: store.version,
    vaultId: store.vaultId,
    activeBaseId: store.activeBaseId,
    deletedBaseIds: store.deletedBaseIds,
    bases: store.bases.map((entry) => ({
      id: entry.id,
      createdAt: entry.createdAt,
      updatedAt: entry.updatedAt,
      semanticRevision: entry.semanticRevision,
      semanticHead: entry.semanticHead,
      semanticHash: entry.semanticHash,
      semanticLineage: entry.semanticLineage,
      archivedAt: entry.archivedAt,
      data: entry.data,
    })),
  });
}

function entryGuard(entry: KnowledgeBaseEntry): string {
  return fingerprint({
    id: entry.id,
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
    semanticRevision: entry.semanticRevision,
    semanticHead: entry.semanticHead,
    semanticHash: entry.semanticHash,
    semanticLineage: entry.semanticLineage,
    archivedAt: entry.archivedAt,
    data: entry.data,
  });
}

function emptyDiff(): PortfolioPlanDiff {
  return {
    basesAdd: [], basesReplace: [],
    headingsAdd: [], headingsRename: [], headingsRemove: [],
    subjectsAdd: [], subjectsMove: [], subjectsUnplaced: [],
    librariesAdd: [], librariesArchive: [],
    conflicts: [], fallbacks: [],
    willNotChange: [],
  };
}

function mergeDiff(target: PortfolioPlanDiff, source: PortfolioPlanDiff): void {
  for (const key of Object.keys(target) as Array<keyof PortfolioPlanDiff>) target[key].push(...source[key]);
}

interface HeadingIdentity {
  id: string;
  title: string;
  label: string;
}

/**
 * Structure keys identify a layout node by its full ancestor ID path. Local
 * layout IDs are only isSafeObjectKey-constrained (the stricter safeId shape
 * applies to imported packages, not persisted local data), so no joiner
 * character can be assumed absent from an ID. JSON-encoding the path array
 * keeps two distinct paths from ever colliding into one key.
 */
function libraryStructureKey(libraryId: string, idPath: readonly string[]): string {
  return JSON.stringify(["library", libraryId, ...idPath]);
}

function headings(data: PluginData): Map<string, HeadingIdentity> {
  const result = new Map<string, HeadingIdentity>();
  for (const group of data.portableIndex.groups) {
    result.set(`index:${group.id}`, { id: group.id, title: group.title, label: `Index heading “${group.title}”` });
  }
  const libraryById = new Map(data.portableIndex.libraries.map((library) => [library.id, library]));
  for (const [libraryId, layout] of Object.entries(data.portableIndex.libraryLayouts)) {
    const libraryName = libraryById.get(libraryId)?.name ?? libraryId;
    const visit = (
      node: LayoutHeading | LayoutSubheading,
      ancestorIds: readonly string[],
      ancestorTitles: readonly string[],
    ): void => {
      const idPath = [...ancestorIds, node.id];
      const titlePath = [...ancestorTitles, node.title];
      result.set(libraryStructureKey(libraryId, idPath), {
        id: node.id,
        title: node.title,
        label: idPath.length === 1
          ? `${libraryName} heading “${node.title}”`
          : `${libraryName} subheading “${titlePath.join(" / ")}”`,
      });
      for (const child of childSubheadings(node)) visit(child, idPath, titlePath);
    };
    for (const heading of layout) visit(heading, [], []);
  }
  return result;
}

interface SubjectPlacement {
  key: string;
  label: string;
  unplaced: boolean;
}

function subjectPlacements(data: PluginData): Map<string, SubjectPlacement> {
  const result = new Map<string, SubjectPlacement>();
  const groups = new Map(data.portableIndex.groups.map((group) => [group.id, group.title]));
  const subjects = new Map(data.portableIndex.subjects.map((subject) => [subject.id, subject]));
  const libraries = new Map(data.portableIndex.libraries.map((library) => [library.id, library.name]));
  const placed = new Map<string, { key: string; label: string }>();
  for (const [libraryId, layout] of Object.entries(data.portableIndex.libraryLayouts)) {
    const library = libraries.get(libraryId) ?? libraryId;
    const visit = (
      node: LayoutHeading | LayoutSubheading,
      ancestorIds: readonly string[],
      ancestorTitles: readonly string[],
    ): void => {
      const idPath = [...ancestorIds, node.id];
      const titlePath = [...ancestorTitles, node.title];
      for (const id of node.subjects) placed.set(id, {
        key: libraryStructureKey(libraryId, idPath),
        label: `${library} / ${titlePath.join(" / ")}`,
      });
      for (const child of childSubheadings(node)) visit(child, idPath, titlePath);
    };
    for (const heading of layout) visit(heading, [], []);
  }
  for (const subject of subjects.values()) {
    if (subject.indexed) {
      const parent = subject.parentId ? subjects.get(subject.parentId)?.title ?? subject.parentId : "top level";
      const group = groups.get(subject.groupId) ?? "Ungrouped";
      result.set(subject.id, { key: `index:${subject.groupId}:${subject.parentId ?? ""}`, label: `Index / ${group} / ${parent}`, unplaced: false });
      continue;
    }
    const libraryId = subjectLibraryId(subject);
    if (libraryId) {
      const placement = placed.get(subject.id);
      if (placement) result.set(subject.id, { ...placement, unplaced: false });
      else result.set(subject.id, { key: `library:${libraryId}:unplaced`, label: `${libraries.get(libraryId) ?? libraryId} / Unplaced`, unplaced: true });
      continue;
    }
    result.set(subject.id, { key: "dependency:unplaced", label: "Unplaced portable dependency", unplaced: true });
  }
  return result;
}

function conflictPreview(
  before: PluginData,
  incoming: PortableExportV1,
  selection: PortableExportSelection,
  destinationName: string,
): string[] {
  const conflicts: string[] = [];
  const index = incoming.components.index;
  if (!index) return conflicts;
  const selected = normalizePortableSelection(selection);
  const includedSubjectIds = new Set<string>();
  if (selected.collections) {
    const collectIds = (node: PortableCollectionV1 | PortableCollectionSubheadingV1): void => {
      node.subjectIds.forEach((id) => includedSubjectIds.add(id));
      for (const child of node.subheadings ?? []) collectIds(child);
    };
    for (const collection of incoming.components.collections?.collections ?? []) collectIds(collection);
  }
  if (selected.study) {
    incoming.components.study?.pinnedSubjectIds.forEach((id) => includedSubjectIds.add(id));
    incoming.components.study?.nextSubjectIds.forEach((id) => includedSubjectIds.add(id));
  }
  for (const subject of index.subjects) {
    if ((selected.index && subject.indexed) || selected.libraryIds.includes(subjectLibraryId(subject) ?? "")) {
      includedSubjectIds.add(subject.id);
    }
  }
  if (selected.index) {
    const subjectById = new Map(index.subjects.map((subject) => [subject.id, subject]));
    const stack = [...includedSubjectIds];
    while (stack.length > 0) {
      const parentId = subjectById.get(stack.pop() ?? "")?.parentId;
      if (!parentId || includedSubjectIds.has(parentId)) continue;
      includedSubjectIds.add(parentId);
      stack.push(parentId);
    }
  }
  const includedGroupIds = new Set(index.subjects
    .filter((subject) => includedSubjectIds.has(subject.id))
    .map((subject) => subject.groupId));
  if (selected.index) {
    for (const id of index.indexGroupIds ?? (index.includeIndex === false ? [] : index.groups.map((group) => group.id))) {
      includedGroupIds.add(id);
    }
  }
  const localGroups = new Map(before.portableIndex.groups.map((group) => [group.id, group]));
  for (const group of index.groups.filter((candidate) => includedGroupIds.has(candidate.id))) {
    const local = localGroups.get(group.id);
    if (local && local.title.normalize("NFC").toLowerCase() !== group.title.normalize("NFC").toLowerCase()) {
      conflicts.push(`${destinationName}: heading ID ${group.id} is local “${local.title}” and incoming “${group.title}”; the plan allocates or maps a safe destination heading.`);
    }
  }
  const localSubjects = new Map(before.portableIndex.subjects.map((subject) => [subject.id, subject]));
  for (const subject of index.subjects.filter((candidate) => includedSubjectIds.has(candidate.id))) {
    const local = localSubjects.get(subject.id);
    if (!local) continue;
    const localScope = local.indexed ? "Index" : subjectLibraryId(local) ?? "unplaced";
    const incomingScope = subject.indexed ? "Index" : subjectLibraryId(subject) ?? "unplaced";
    if (localScope !== incomingScope || local.title.normalize("NFC") !== subject.title.normalize("NFC")) {
      conflicts.push(`${destinationName}: subject ID ${subject.id} differs (${localScope} “${local.title}” → ${incomingScope} “${subject.title}”); the exact resolved result is shown below.`);
    }
  }
  const localLibraries = new Map(before.portableIndex.libraries.map((library) => [library.id, library]));
  for (const library of (index.libraries ?? []).filter((candidate) => selected.libraryIds.includes(candidate.id))) {
    const local = localLibraries.get(library.id);
    if (local && (local.name !== library.name || local.sourceKind !== library.sourceKind)) {
      conflicts.push(`${destinationName}: Library ID ${library.id} is local “${local.name}” and incoming “${library.name}”.`);
    }
  }
  return conflicts;
}

function diffData(
  before: PluginData | null,
  after: PluginData,
  destinationName: string,
  destinationKind: PortfolioDestination["kind"],
  mode: PortableImportMode,
  fallbacks: string[],
  conflicts: string[],
): PortfolioPlanDiff {
  const diff = emptyDiff();
  if (destinationKind === "new") diff.basesAdd.push(`Add knowledge base “${destinationName}”.`);
  else if (mode === "replace") diff.basesReplace.push(`Replace selected components in “${destinationName}”.`);
  const beforeHeadings = before ? headings(before) : new Map<string, HeadingIdentity>();
  const afterHeadings = headings(after);
  for (const [key, heading] of afterHeadings) {
    const prior = beforeHeadings.get(key);
    if (!prior) diff.headingsAdd.push(`${destinationName}: add ${heading.label}.`);
    else if (prior.title !== heading.title) diff.headingsRename.push(`${destinationName}: rename “${prior.title}” to “${heading.title}”.`);
  }
  for (const [key, heading] of beforeHeadings) {
    if (!afterHeadings.has(key)) diff.headingsRemove.push(`${destinationName}: remove ${heading.label} from plugin organization.`);
  }
  const beforeSubjects = new Map((before?.portableIndex.subjects ?? []).map((subject) => [subject.id, subject]));
  const afterSubjects = new Map(after.portableIndex.subjects.map((subject) => [subject.id, subject]));
  const beforePlacements = before ? subjectPlacements(before) : new Map<string, SubjectPlacement>();
  const afterPlacements = subjectPlacements(after);
  for (const [id, subject] of afterSubjects) {
    const prior = beforeSubjects.get(id);
    const placement = afterPlacements.get(id);
    if (!prior) diff.subjectsAdd.push(`${destinationName}: add subject “${subject.title}”${placement ? ` in ${placement.label}` : ""}.`);
    else if (beforePlacements.get(id)?.key !== placement?.key) {
      diff.subjectsMove.push(`${destinationName}: move “${subject.title}” from ${beforePlacements.get(id)?.label ?? "unplaced"} to ${placement?.label ?? "unplaced"}.`);
    }
    if (placement?.unplaced && (!prior || !beforePlacements.get(id)?.unplaced)) {
      diff.subjectsUnplaced.push(`${destinationName}: “${subject.title}” will remain available under ${placement.label}.`);
    }
  }
  const beforeLibraries = new Map((before?.portableIndex.libraries ?? []).map((library) => [library.id, library]));
  for (const library of after.portableIndex.libraries) {
    const prior = beforeLibraries.get(library.id);
    if (!prior) diff.librariesAdd.push(`${destinationName}: add Library “${library.name}”${(after.portableIndex.libraryLayouts[library.id]?.length ?? 0) === 0 ? " (empty)" : ""}.`);
    if (prior?.archivedAt === null && library.archivedAt !== null) diff.librariesArchive.push(`${destinationName}: archive Library “${library.name}”.`);
  }
  diff.conflicts.push(...conflicts);
  diff.fallbacks.push(...fallbacks);
  diff.willNotChange.push(
    `${destinationName}: Markdown note bodies and attachments will not change.`,
    `${destinationName}: vault files will not be created, moved, renamed, or deleted.`,
    `${destinationName}: unselected components will not change.`,
  );
  return diff;
}

function assertSelectionIsAvailable(
  requested: PortableExportSelection,
  available: PortableExportSelection,
  sourceName: string,
): PortableExportSelection {
  const selected = normalizePortableSelection(requested);
  const present = normalizePortableSelection(available);
  for (const key of ["workspace", "index", "collections", "study", "savedViews"] as const) {
    if (selected[key] && !present[key]) throw new Error(`“${sourceName}” does not contain the selected ${key} component.`);
  }
  const availableLibraries = new Set(present.libraryIds);
  for (const id of selected.libraryIds) {
    if (!availableLibraries.has(id)) throw new Error(`“${sourceName}” does not contain Library ${id}.`);
  }
  if (selected.recovery) throw new Error("Private recovery cannot be selected from a portfolio transfer.");
  if (!portableSelectionHasAny(selected)) throw new Error(`Choose at least one component from “${sourceName}”.`);
  return normalizedSelectionForManifest(selected);
}

function uniqueBaseName(store: PluginStore, requested: string, reserved: Set<string>): string {
  const used = new Set(store.bases.filter((entry) => entry.archivedAt === null)
    .map((entry) => normalizedNameKey(entry.data.settings.workspaceName)));
  reserved.forEach((name) => used.add(normalizedNameKey(name)));
  const root = safeName(requested, "Destination knowledge-base name");
  let candidate = root;
  let suffix = 2;
  while (used.has(candidate.toLowerCase())) {
    const tag = ` (${suffix})`;
    candidate = `${root.slice(0, Math.max(1, 100 - tag.length)).trim()}${tag}`;
    suffix += 1;
  }
  reserved.add(candidate);
  return candidate;
}

function allocateDestinationId(sourceBaseId: string, planSeed: string, unavailable: Set<string>): string {
  const root = `base-portfolio-${fingerprint(`${planSeed}:${sourceBaseId}`)}`;
  let candidate = root;
  let suffix = 2;
  while (unavailable.has(candidate)) {
    candidate = `${root}-${suffix}`;
    suffix += 1;
  }
  unavailable.add(candidate);
  return candidate;
}

function freshDestinationData(mode: WorkspaceMode, name: string): PluginData {
  const data = structuredClone(DEFAULT_DATA);
  data.settings = structuredClone(mode === "ent-clinical" ? ENT_CLINICAL_SETTINGS : DEFAULT_SETTINGS);
  data.settings.setupComplete = true;
  data.settings.workspaceMode = mode;
  data.settings.workspaceName = name;
  data.selectedPath = "";
  data.activeTab = data.settings.defaultTab;
  return data;
}

function sanitizeWorkspaceResources(
  before: PluginData,
  after: PluginData,
  resources: PortfolioResourceResolver | undefined,
  destinationName: string,
): string[] {
  const fallbacks: string[] = [];
  const settings = after.settings;
  const configDir = resources?.configDir ?? "";
  for (const key of ["primaryFolder", "defaultNoteFolder", "templatesFolder"] as const) {
    const validation = validateWritableFolderPath(settings[key], configDir);
    if (validation) throw new Error(validation);
    if (resources?.folderExists && !resources.folderExists(settings[key])) {
      const unavailable = settings[key];
      settings[key] = before.settings[key];
      fallbacks.push(`${destinationName}: unavailable ${key} “${unavailable}” falls back to “${settings[key]}”.`);
    }
  }
  const proposalValidation = settings.workspaceMode === "ent-clinical"
    ? validateProposalFolderPath(settings.proposalFolder, configDir)
    : validateWritableFolderPath(settings.proposalFolder, configDir);
  if (proposalValidation) throw new Error(proposalValidation);
  if (resources?.folderExists && !resources.folderExists(settings.proposalFolder)) {
    const unavailable = settings.proposalFolder;
    settings.proposalFolder = before.settings.proposalFolder;
    fallbacks.push(`${destinationName}: unavailable proposal folder “${unavailable}” falls back to “${settings.proposalFolder}”.`);
  }
  if (settings.attachmentStorageMode === "fixed-folder") {
    const attachmentValidation = validateWritableFolderPath(settings.attachmentFolder, configDir);
    if (attachmentValidation) throw new Error(attachmentValidation);
  }
  if (settings.defaultNewNoteMode === "template") {
    const invalid = validateTemplateFilePath(settings.defaultTemplatePath, settings.templatesFolder, configDir);
    const missing = resources?.templateExists && !resources.templateExists(settings.defaultTemplatePath);
    if (invalid || missing) {
      const unavailable = settings.defaultTemplatePath || "(no template)";
      settings.defaultNewNoteMode = "empty";
      settings.defaultTemplatePath = "";
      fallbacks.push(`${destinationName}: unavailable default template “${unavailable}” falls back to Empty note.`);
    }
  }
  for (const [libraryId, profile] of Object.entries(settings.libraryNoteProfiles)) {
    if (profile.folder !== undefined) {
      const validation = validateWritableFolderPath(profile.folder, configDir);
      if (validation) throw new Error(validation);
      if (resources?.folderExists && !resources.folderExists(profile.folder)) {
        const unavailable = profile.folder;
        delete profile.folder;
        fallbacks.push(`${destinationName}: Library ${libraryId} unavailable folder “${unavailable}” falls back to the base default.`);
      }
    }
    if (profile.templatePath) {
      const invalid = validateTemplateFilePath(profile.templatePath, settings.templatesFolder, configDir);
      const missing = resources?.templateExists && !resources.templateExists(profile.templatePath);
      if (invalid || missing) {
        const unavailable = profile.templatePath;
        profile.mode = "empty";
        delete profile.templatePath;
        fallbacks.push(`${destinationName}: Library ${libraryId} unavailable template “${unavailable}” falls back to Empty note.`);
      }
    }
  }
  return fallbacks;
}

function buildRecoveryPackage(
  entry: KnowledgeBaseEntry,
  vaultId: string,
  exportedAt: string,
): PortfolioRecoveryPackage {
  const backup: PersonalBackup = createPersonalBackup(
    entry.data,
    exportedAt,
    vaultId,
    entry.id,
    entry.data.settings.workspaceName,
  );
  const portable: PortableExportV1 = {
    kind: "knowledge-base-command-center-portable-export",
    version: PORTABLE_EXPORT_VERSION,
    exportedAt,
    sourceWorkspace: entry.data.settings.workspaceName,
    components: { recovery: backup },
  };
  // Automatic recovery must itself be accepted by the existing strict parser
  // and fit the same bounded package that the ordinary restore UI supports.
  const parsed = parsePortableExport(JSON.parse(serializePortableExport(portable)) as unknown);
  return { destinationBaseId: entry.id, destinationBaseName: entry.data.settings.workspaceName, package: parsed };
}

function planPayload(plan: Omit<PortfolioImportPlan, "planGuard">): unknown {
  return plan;
}

function applyPlanUnchecked(store: PluginStore, operations: readonly PortfolioPlanOperation[]): void {
  for (const operation of operations) {
    const index = store.bases.findIndex((entry) => entry.id === operation.destinationBaseId);
    if (operation.destinationKind === "new") {
      if (index >= 0 || Object.prototype.hasOwnProperty.call(store.deletedBaseIds, operation.destinationBaseId)) {
        throw new Error(`Destination knowledge base ${operation.destinationBaseId} is no longer available for creation.`);
      }
      store.bases.push(structuredClone(operation.afterEntry));
      continue;
    }
    const current = index >= 0 ? store.bases[index] : undefined;
    if (!current || current.archivedAt !== null || entryGuard(current) !== operation.beforeEntryGuard) {
      throw new Error(`Destination knowledge base “${operation.destinationBaseName}” changed after the preview was prepared.`);
    }
    store.bases[index] = structuredClone(operation.afterEntry);
  }
}

export function createPortfolioImportPlan(
  store: PluginStore,
  bundleInput: unknown,
  mappings: readonly PortfolioImportMapping[],
  options: PortfolioImportPlanOptions = {},
): PortfolioImportPlan {
  const bundle = parsePortfolioExport(bundleInput);
  if (mappings.length < 1 || mappings.length > bundle.manifest.baseCount) {
    throw new Error("Choose at least one source base and map each source at most once.");
  }
  for (const mapping of mappings) {
    if (!mapping || typeof mapping !== "object" || !mapping.destination
      || (mapping.destination.kind !== "new" && mapping.destination.kind !== "existing")) {
      throw new Error("A portfolio mapping has an unsupported destination.");
    }
    if (mapping.mode !== "merge" && mapping.mode !== "replace") {
      throw new Error("A portfolio mapping has an unsupported import mode.");
    }
    if (mapping.destination.kind === "new" && mapping.mode !== "merge") {
      throw new Error("A new knowledge base is initialized with Merge; Replace is only available for an existing destination.");
    }
  }
  const sourceManifest = new Map(bundle.manifest.entries.map((entry) => [entry.sourceBaseId, entry]));
  const sourcePackages = new Map(bundle.packages.map((entry) => [entry.sourceBaseId, entry.package]));
  const mappedSources = new Set<string>();
  const mappedDestinations = new Set<string>();
  const unavailableIds = new Set([...store.bases.map((entry) => entry.id), ...Object.keys(store.deletedBaseIds)]);
  const reservedNames = new Set<string>();
  const additions = mappings.filter((mapping) => mapping.destination.kind === "new").length;
  if (store.bases.length + additions > MAX_KNOWLEDGE_BASES) {
    throw new Error(`This import would exceed the ${MAX_KNOWLEDGE_BASES}-knowledge-base limit.`);
  }
  const crossVault = bundle.sourceVaultId !== store.vaultId;
  const replacingCrossVault = crossVault && mappings.some((mapping) => mapping.destination.kind === "existing" && mapping.mode === "replace");
  if (replacingCrossVault && !options.allowCrossVaultReplace) {
    throw new Error("A cross-vault Replace requires the separate cross-vault replacement acknowledgement.");
  }
  const now = options.now ?? Date.now();
  if (!Number.isSafeInteger(now) || now <= 0) throw new Error("The portfolio plan timestamp is invalid.");
  const expectedStoreGuard = storeGuard(store);
  const seed = fingerprint({ bundle, expectedStoreGuard, now, mappings });
  const operations: PortfolioPlanOperation[] = [];
  const recoveryPackages: PortfolioRecoveryPackage[] = [];
  const aggregateDiff = emptyDiff();
  for (const mapping of mappings) {
    const sourceBaseId = safeStableId(mapping.sourceBaseId, "Mapped source knowledge base");
    if (mappedSources.has(sourceBaseId)) throw new Error(`Source knowledge base ${sourceBaseId} is mapped more than once.`);
    mappedSources.add(sourceBaseId);
    const manifest = sourceManifest.get(sourceBaseId);
    const portable = sourcePackages.get(sourceBaseId);
    if (!manifest || !portable) throw new Error(`Source knowledge base ${sourceBaseId} is not in this portfolio.`);
    const selection = assertSelectionIsAvailable(
      mapping.selection ?? manifest.selection,
      manifest.selection,
      manifest.sourceBaseName,
    );
    let beforeEntry: KnowledgeBaseEntry | null = null;
    let destinationBaseId = "";
    let destinationBaseName = "";
    let working: KnowledgeBaseEntry;
    if (mapping.destination.kind === "existing") {
      destinationBaseId = safeStableId(mapping.destination.baseId, "Destination knowledge base");
      if (mappedDestinations.has(destinationBaseId)) throw new Error(`Destination knowledge base ${destinationBaseId} is mapped more than once.`);
      mappedDestinations.add(destinationBaseId);
      beforeEntry = store.bases.find((entry) => entry.id === destinationBaseId) ?? null;
      if (!beforeEntry || beforeEntry.archivedAt !== null) throw new Error("A mapped destination knowledge base is unavailable or archived.");
      if (beforeEntry.data.settings.workspaceMode !== manifest.sourceWorkspaceMode) {
        throw new Error(`“${manifest.sourceBaseName}” uses a different preset from “${beforeEntry.data.settings.workspaceName}”.`);
      }
      destinationBaseName = beforeEntry.data.settings.workspaceName;
      working = structuredClone(beforeEntry);
      if (mapping.mode === "replace") {
        recoveryPackages.push(buildRecoveryPackage(beforeEntry, store.vaultId, new Date(now).toISOString()));
      }
    } else {
      destinationBaseName = uniqueBaseName(store, mapping.destination.name || manifest.sourceBaseName, reservedNames);
      destinationBaseId = allocateDestinationId(sourceBaseId, seed, unavailableIds);
      working = createKnowledgeBaseEntry(
        freshDestinationData(manifest.sourceWorkspaceMode, destinationBaseName),
        destinationBaseId,
        now,
      );
      mappedDestinations.add(destinationBaseId);
    }
    const beforeData = structuredClone(working.data);
    const conflicts = conflictPreview(beforeData, portable, selection, destinationBaseName);
    const records = mapping.destination.kind === "existing"
      ? [...(options.recordsByBaseId?.get(destinationBaseId) ?? [])]
      : [];
    if (selectionUsesSubjects(selection)) synchronizePortableRegistry(working.data, records);
    assertPortableImportDestinationCompatible(portable, selection, working.data.settings.workspaceMode);
    const undo = snapshotPersonal(
      beforeData,
      `${mapping.mode === "merge" ? "Merge" : "Replace"} portfolio source “${manifest.sourceBaseName}”`,
      selection.workspace,
      selectionUsesSubjects(selection) || selection.workspace || selection.savedViews,
      false,
      true,
    );
    undo.at = now;
    const undoStack = limitSnapshotStack([...working.data.undoStack, undo]);
    if (!undoStack.includes(undo)) {
      throw new Error(`“${destinationBaseName}” is too large for safe in-plugin Undo. Reduce the selected components.`);
    }
    working.data.undoStack = undoStack;
    working.data.redoStack = [];
    const result = applyPortableExport(working.data, portable, selection, mapping.mode);
    const selectedLibraryIds = selection.libraryIds ?? [];
    const completeSourceLibraryIds = manifest.selection.libraryIds ?? [];
    const importsCompleteLibrarySet = mapping.mode === "replace"
      && manifest.completeLibrarySet
      && new Set(selectedLibraryIds).size === new Set(completeSourceLibraryIds).size
      && completeSourceLibraryIds.every((libraryId) => selectedLibraryIds.includes(libraryId));
    if (importsCompleteLibrarySet) {
      const importedLibraryIds = new Set(selectedLibraryIds);
      for (const library of working.data.portableIndex.libraries) {
        if (library.archivedAt === null && !importedLibraryIds.has(library.id)) library.archivedAt = now;
      }
      normalizeKnowledgeBaseLibrariesAndNavigation(working.data);
    }
    const fallbacks = selection.workspace
      ? sanitizeWorkspaceResources(beforeData, working.data, options.resources, destinationBaseName)
      : [];
    // Destination identity and preset are invariants even for a newly-created
    // base whose source workspace settings were selected.
    working.data.settings.workspaceName = destinationBaseName;
    working.data.settings.workspaceMode = manifest.sourceWorkspaceMode;
    if (beforeEntry) {
      if (!Number.isSafeInteger(beforeEntry.semanticRevision)
        || beforeEntry.semanticRevision < 0
        || beforeEntry.semanticRevision >= Number.MAX_SAFE_INTEGER) {
        throw new Error(`“${destinationBaseName}” has no safe semantic revision remaining.`);
      }
      working.semanticRevision = beforeEntry.semanticRevision + 1;
      working.updatedAt = Math.max(now, beforeEntry.updatedAt + 1);
      working.semanticHash = semanticEntryFingerprint(working);
      working.semanticHead = deterministicSemanticHead(
        beforeEntry.semanticHead,
        working.semanticHash,
        `portfolio-import:${seed}:${sourceBaseId}`,
      );
      working.semanticLineage = boundedSemanticLineage([
        beforeEntry.semanticHead,
        ...beforeEntry.semanticLineage,
      ], working.semanticHead);
    } else {
      working.semanticHash = semanticEntryFingerprint(working);
      working.semanticHead = working.semanticHash;
      working.semanticLineage = [];
    }
    const diff = diffData(
      beforeEntry ? beforeData : null,
      working.data,
      destinationBaseName,
      mapping.destination.kind,
      mapping.mode,
      fallbacks,
      conflicts,
    );
    mergeDiff(aggregateDiff, diff);
    operations.push({
      sourceBaseId,
      sourceBaseName: manifest.sourceBaseName,
      destinationKind: mapping.destination.kind,
      destinationBaseId,
      destinationBaseName,
      mode: mapping.mode,
      selection,
      beforeEntryGuard: beforeEntry ? entryGuard(beforeEntry) : "",
      afterEntry: working,
      result,
      diff,
    });
  }
  aggregateDiff.willNotChange.push(
    "The source portfolio and its independent portable packages will remain immutable.",
    "The active knowledge-base selection will not change.",
  );
  const replaceCount = operations.filter((operation) => operation.destinationKind === "existing" && operation.mode === "replace").length;
  const confirmationPhrase = replaceCount > 0 ? `REPLACE ${replaceCount} ${replaceCount === 1 ? "BASE" : "BASES"}` : "";
  const expectedExternalGeneration = options.expectedExternalGeneration ?? 0;
  if (!Number.isSafeInteger(expectedExternalGeneration) || expectedExternalGeneration < 0) {
    throw new Error("The external-change generation is invalid.");
  }
  const afterStore = structuredClone(store);
  applyPlanUnchecked(afterStore, operations);
  const withoutGuard: Omit<PortfolioImportPlan, "planGuard"> = {
    kind: "knowledge-base-command-center-portfolio-import-plan",
    version: 1,
    id: `portfolio-plan-${seed}`,
    createdAt: now,
    sourceVaultId: bundle.sourceVaultId,
    expectedStoreGuard,
    expectedAfterStoreGuard: storeGuard(afterStore),
    expectedActiveBaseId: store.activeBaseId,
    expectedExternalGeneration,
    crossVault,
    confirmationPhrase,
    operations,
    recoveryPackages,
    diff: aggregateDiff,
  };
  return { ...withoutGuard, planGuard: fingerprint(planPayload(withoutGuard)) };
}

export function applyPortfolioImportPlan(
  store: PluginStore,
  plan: PortfolioImportPlan,
  typedConfirmation = "",
  currentExternalGeneration = plan.expectedExternalGeneration,
): void {
  const { planGuard, ...withoutGuard } = plan;
  if (plan.kind !== "knowledge-base-command-center-portfolio-import-plan"
    || plan.version !== 1
    || fingerprint(planPayload(withoutGuard)) !== planGuard) {
    throw new Error("The portfolio mutation plan changed after preview. Prepare it again.");
  }
  if (plan.confirmationPhrase && typedConfirmation !== plan.confirmationPhrase) {
    throw new Error(`Type ${plan.confirmationPhrase} exactly before applying this Replace plan.`);
  }
  if (store.activeBaseId !== plan.expectedActiveBaseId) {
    throw new Error("The active knowledge base changed after the portfolio preview was prepared.");
  }
  if (currentExternalGeneration !== plan.expectedExternalGeneration) {
    throw new Error("Synced plugin data changed after the portfolio preview was prepared.");
  }
  if (storeGuard(store) !== plan.expectedStoreGuard) {
    throw new Error("Knowledge-base data changed after the portfolio preview was prepared.");
  }
  const candidate = structuredClone(store);
  applyPlanUnchecked(candidate, plan.operations);
  if (storeGuard(candidate) !== plan.expectedAfterStoreGuard) {
    throw new Error("The portfolio plan no longer produces its previewed exact result.");
  }
  store.bases = candidate.bases;
  store.activeBaseId = candidate.activeBaseId;
  store.deletedBaseIds = candidate.deletedBaseIds;
}

/** Stable guard exposed for plan/apply identity tests and UI staleness diagnostics. */
export function portfolioStoreGuard(store: PluginStore): string {
  return storeGuard(store);
}

/** Small helper for preview renderers that want deterministic category order. */
export const PORTFOLIO_DIFF_CATEGORIES: ReadonlyArray<keyof PortfolioPlanDiff> = [
  "basesAdd", "basesReplace",
  "headingsAdd", "headingsRename", "headingsRemove",
  "subjectsAdd", "subjectsMove", "subjectsUnplaced",
  "librariesAdd", "librariesArchive",
  "conflicts", "fallbacks", "willNotChange",
];

/** Keep the type dependency visible for callers that render nested heading counts. */
export function portfolioLayoutStructureCount(layout: readonly (LayoutHeading | LayoutSubheading)[]): number {
  return layout.reduce((count, node) => count + 1 + portfolioLayoutStructureCount(childSubheadings(node)), 0);
}
