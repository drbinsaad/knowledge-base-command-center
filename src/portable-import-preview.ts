import {
  cloneJsonValue,
  type PluginData,
  type VaultRecord,
} from "./model";
import {
  buildPlaceholderResolutionQueue,
  type PlaceholderMatchNote,
  type PlaceholderResolutionQueue,
} from "./membership-explanation";
import {
  applyPortableExport,
  assertPortableImportDestinationCompatible,
  EMPTY_PORTABLE_SELECTION,
  normalizePortableSelection,
  portableSelectionHasAny,
  synchronizePortableRegistry,
  type PortableExportSelection,
  type PortableExportV1,
  type PortableImportMode,
  type PortableImportResult,
} from "./portability";

export const LARGE_PLACEHOLDER_IMPORT_THRESHOLD = 100;

export interface PortableImportOutcomePreview {
  result: PortableImportResult;
  before: PlaceholderResolutionQueue;
  after: PlaceholderResolutionQueue;
  /** Selected incoming subjects that the import engine predicts will still need a note. */
  importedAwaitingNotes: number;
  /** Exact local candidates across the destination's complete post-import queue. No candidate is auto-selected. */
  postImportCandidates: number;
  requiresLargeImportConfirmation: boolean;
}

const WORKSPACE_RECORD_PROJECTION_FIELDS = [
  ["primaryFolder", "folder grouping root"],
  ["proposalFolder", "Inbox folder"],
  ["inboxLabel", "Inbox group label"],
  ["idProperty", "configured-ID property"],
  ["groupProperty", "group property"],
  ["parentProperty", "parent property"],
  ["templatesFolder", "Templates folder eligibility"],
  ["allowClinicalVisualGroupMoves", "clinical visual-group behavior"],
] as const;

/**
 * Name incoming Workspace values that would change the record projection used
 * to synchronize a selected portable subject catalog. The clinical preset
 * protects its destination primary folder, so that field is effective only in
 * a Generic knowledge base.
 */
export function workspaceImportRecordProjectionChanges(
  data: Pick<PluginData, "settings" | "indexGroupOrder">,
  value: PortableExportV1,
  requestedSelection: PortableExportSelection,
): string[] {
  const selection = normalizePortableSelection(requestedSelection);
  const incoming = selection.workspace ? value.components.workspace : undefined;
  if (!incoming || !selectionUsesSubjectCatalog(selection)) return [];
  const changes: string[] = [];
  for (const [key, label] of WORKSPACE_RECORD_PROJECTION_FIELDS) {
    const currentValue = data.settings[key];
    const incomingValue = key === "primaryFolder" && data.settings.workspaceMode === "ent-clinical"
      ? currentValue
      : incoming.settings[key];
    if (incomingValue !== currentValue) changes.push(label);
  }
  if (JSON.stringify(incoming.indexGroupOrder) !== JSON.stringify(data.indexGroupOrder)) {
    changes.push("group ordering");
  }
  return changes;
}

function assertWorkspaceCatalogPreviewIsStable(
  data: Pick<PluginData, "settings" | "indexGroupOrder">,
  value: PortableExportV1,
  selection: PortableExportSelection,
): void {
  const changes = workspaceImportRecordProjectionChanges(data, value, selection);
  if (changes.length === 0) return;
  throw new Error(`Workspace settings would change ${changes.join(", ")}, which determine how local Markdown notes are interpreted. Import Workspace settings by themselves first. After KBCC refreshes the vault, reopen this center and import the Index, Libraries, Collections, or Study state.`);
}

function selectionUsesSubjectCatalog(selection: PortableExportSelection): boolean {
  const normalized = normalizePortableSelection(selection);
  return normalized.index
    || normalized.libraryIds.length > 0
    || normalized.collections
    || normalized.study;
}

/**
 * Simulate the production two-phase portable import against an isolated copy.
 * This preview deliberately does not support private recovery: recovery has a
 * separate identity/path preflight and must not be summarized as a portable
 * placeholder operation.
 */
export function previewPortableImportOutcome(
  data: PluginData,
  records: readonly VaultRecord[],
  value: PortableExportV1,
  requestedSelection: PortableExportSelection,
  mode: PortableImportMode,
  placeholderMatchNotes: readonly PlaceholderMatchNote[] = records,
): PortableImportOutcomePreview | null {
  const selection = normalizePortableSelection(requestedSelection);
  if (!portableSelectionHasAny(selection) || selection.recovery) return null;
  assertPortableImportDestinationCompatible(value, selection, data.settings.workspaceMode);
  assertWorkspaceCatalogPreviewIsStable(data, value, selection);

  const before = buildPlaceholderResolutionQueue(data, placeholderMatchNotes, records);
  const previewData = cloneJsonValue(data);
  const firstSelection: PortableExportSelection = {
    ...EMPTY_PORTABLE_SELECTION,
    workspace: selection.workspace,
  };
  if (portableSelectionHasAny(firstSelection)) {
    applyPortableExport(previewData, value, firstSelection, mode);
  }
  if (selectionUsesSubjectCatalog(selection)) {
    synchronizePortableRegistry(previewData, [...records]);
  }
  const remainingSelection: PortableExportSelection = {
    ...selection,
    workspace: false,
    recovery: false,
  };
  const result = portableSelectionHasAny(remainingSelection)
    ? applyPortableExport(previewData, value, remainingSelection, mode)
    : {
      addedSubjects: 0,
      updatedSubjects: 0,
      matchedSubjects: 0,
      unresolvedSubjects: 0,
      importedCollections: 0,
      importedViews: 0,
    };
  const after = buildPlaceholderResolutionQueue(previewData, placeholderMatchNotes, records);
  return {
    result,
    before,
    after,
    importedAwaitingNotes: result.unresolvedSubjects,
    postImportCandidates: after.withCandidates,
    requiresLargeImportConfirmation: result.unresolvedSubjects >= LARGE_PLACEHOLDER_IMPORT_THRESHOLD,
  };
}
