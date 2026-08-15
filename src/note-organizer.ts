import {
  boundedSemanticLineage,
  canonicalJsonString,
  childSubheadings,
  cloneJsonValue,
  codeUnitCompare,
  deterministicSemanticHead,
  fingerprintText,
  isImmutableSourcePath,
  isLibraryKind,
  isSafeObjectKey,
  limitSnapshotStack,
  MAX_KNOWLEDGE_BASES,
  MAX_LIBRARIES,
  MAX_TRANSFER_COLLECTIONS,
  MAX_TRANSFER_LIST_ITEMS,
  MAX_TRANSFER_TEXT_LENGTH,
  MAX_TRANSFER_TOTAL_REFERENCES,
  migrateStore,
  normalizedNameKey,
  pathIsInIndexFolderSources,
  pathIsInsideFolder,
  pluginDataSemanticallyEqual,
  semanticEntryFingerprint,
  snapshotPersonal,
  subjectLibraryId,
  type KnowledgeBaseEntry,
  type LayoutHeading,
  type LayoutSubheading,
  type LibraryDefinition,
  type PluginData,
  type PluginStore,
  type PortableSubjectDefinition,
  type RecordKind,
  type RecordRole,
} from "./model";

/** Hard UI/domain limits keep one synchronous organizer transaction bounded. */
export const MAX_NOTE_ORGANIZER_NOTES = 5_000;
export const MAX_NOTE_ORGANIZER_DIRECTIVES = 20_000;
export const MAX_NOTE_ORGANIZER_COLLECTION_TARGETS = 50_000;
export const MAX_NOTE_ORGANIZER_INPUT_TEXT_BYTES = 8 * 1024 * 1024;
export const MAX_NOTE_ORGANIZER_PLAN_BYTES = 32 * 1024 * 1024;
export const MAX_NOTE_ORGANIZER_LABEL_LENGTH = 200;

const NOTE_ORGANIZER_KIND = "knowledge-base-command-center-note-organizer-plan" as const;
const NOTE_ORGANIZER_VERSION = 1 as const;
const MAX_ORGANIZATION_LABEL_LENGTH = 100;
const utf8Encoder = new TextEncoder();

const RECORD_KINDS: readonly RecordKind[] = [
  "topic", "procedure", "medication", "syndrome", "proposal", "note",
];
const RECORD_ROLES: readonly RecordRole[] = [
  "canonical", "supporting", "library", "proposal", "vault-note", "placeholder",
];

/**
 * Exact, re-readable vault facts for one selected Markdown note in one target
 * base. Facts are per base because the workspace preset and configured
 * frontmatter keys can project the same file differently in different bases.
 */
export interface NoteOrganizerFileFact {
  path: string;
  baseId: string;
  title: string;
  mtime: number;
  size: number;
  exists: boolean;
  markdown: boolean;
  eligible: boolean;
  sourceKind: RecordKind;
  sourceRole: RecordRole;
  configuredId: string;
  indexEligible: boolean;
  suggestedIndexGroup: string;
}

export type NoteOrganizerPrimaryDirective =
  | { mode: "keep" }
  | { mode: "index"; groupTitle?: string }
  | { mode: "library"; libraryId: string; headingId?: string; subheadingId?: string }
  | { mode: "none" };

export interface NoteOrganizerCollectionTarget {
  headingId: string;
  subheadingId?: string;
}

export type NoteOrganizerCollectionsDirective =
  | { mode: "keep" }
  | { mode: "add"; targets: NoteOrganizerCollectionTarget[] }
  | { mode: "replace"; targets: NoteOrganizerCollectionTarget[] };

/** Missing actions deliberately mean Keep, never Replace or automatic enrollment. */
export interface NoteOrganizerDirective {
  path: string;
  baseId: string;
  primary?: NoteOrganizerPrimaryDirective;
  collections?: NoteOrganizerCollectionsDirective;
}

export interface NoteOrganizerPlanOptions {
  now?: number;
  expectedExternalGeneration?: number;
  label?: string;
}

export interface NoteOrganizerBaseGuard {
  baseId: string;
  baseName: string;
  entryGuard: string;
  semanticFingerprint: string;
  semanticRevision: number;
  semanticHead: string;
  semanticHash: string;
}

export interface NoteOrganizerLayoutMembership {
  headingId: string;
  subheadingId?: string;
  label: string;
}

export type NoteOrganizerPrimaryState =
  | { kind: "none" }
  | { kind: "index"; groupTitle: string }
  | {
    kind: "library";
    libraryId: string;
    libraryName: string;
    placement?: NoteOrganizerLayoutMembership;
    protectedSource: boolean;
  };

export interface NoteOrganizerMembershipState {
  primary: NoteOrganizerPrimaryState;
  collections: NoteOrganizerLayoutMembership[];
}

export interface NoteOrganizerDiff {
  baseId: string;
  baseName: string;
  path: string;
  title: string;
  before: NoteOrganizerMembershipState;
  after: NoteOrganizerMembershipState;
  /** Always explicit for a requested primary change, including Library -> Index. */
  primaryChange: string | null;
  collectionAdds: NoteOrganizerLayoutMembership[];
  collectionRemoves: NoteOrganizerLayoutMembership[];
  portableIdentity: "created" | "reused" | "not-needed";
}

/** Exact before/after state for every requested pair, including no-ops. */
export interface NoteOrganizerReview {
  baseId: string;
  baseName: string;
  path: string;
  title: string;
  before: NoteOrganizerMembershipState;
  after: NoteOrganizerMembershipState;
  changed: boolean;
}

export interface NoteOrganizerSummary {
  selectedNoteCount: number;
  requestedBaseCount: number;
  directiveCount: number;
  changedBaseCount: number;
  changedNoteBaseCount: number;
  noOpDirectiveCount: number;
  primaryChanges: number;
  collectionAdds: number;
  collectionRemoves: number;
  portableSubjectsCreated: number;
  portableSubjectsReused: number;
}

export interface NoteOrganizerPlanOperation {
  baseId: string;
  baseName: string;
  before: NoteOrganizerBaseGuard;
  afterEntry: KnowledgeBaseEntry;
  afterEntryGuard: string;
  undoSnapshotAt: number;
  undoSnapshotFingerprint: string;
  diffs: NoteOrganizerDiff[];
}

export interface NoteOrganizerPlan {
  kind: typeof NOTE_ORGANIZER_KIND;
  version: typeof NOTE_ORGANIZER_VERSION;
  id: string;
  createdAt: number;
  label: string;
  expectedStoreGuard: string;
  expectedAfterStoreGuard: string;
  expectedExternalGeneration: number;
  expectedFileFactsGuard: string;
  fileFacts: NoteOrganizerFileFact[];
  baseGuards: NoteOrganizerBaseGuard[];
  operations: NoteOrganizerPlanOperation[];
  summary: NoteOrganizerSummary;
  reviews: NoteOrganizerReview[];
  diffs: NoteOrganizerDiff[];
  willNotChange: string[];
  planGuard: string;
}

interface NormalizedDirective {
  path: string;
  baseId: string;
  primary: NoteOrganizerPrimaryDirective;
  collections: NoteOrganizerCollectionsDirective;
}

interface BaseMutationContext {
  entry: KnowledgeBaseEntry;
  factByPath: ReadonlyMap<string, NoteOrganizerFileFact>;
  subjectById: Map<string, PortableSubjectDefinition>;
  libraryById: Map<string, LibraryDefinition>;
  ownerIdsByPath: Map<string, string[]>;
  usedSubjectIds: Set<string>;
  usedGroupIds: Set<string>;
  groupById: Map<string, { id: string; title: string; order: number }>;
  groupIdsByName: Map<string, string[]>;
  groupUsageById: Map<string, GroupUsage>;
  directIndexPaths: Set<string>;
  manualIndexPaths: Set<string>;
  excludedIndexPaths: Set<string>;
  indexGroupOrderNames: Set<string>;
  collectionTargets: Map<string, IndexedLayoutNode | null>;
  collectionNodesByPath: Map<string, Set<OrganizerLayoutNode>>;
  collectionNodeMetadata: Map<OrganizerLayoutNode, NoteOrganizerLayoutMembership>;
  collectionSubjectCountsByNode: Map<OrganizerLayoutNode, Map<string, number>>;
  collectionDesiredMembershipByNode: Map<OrganizerLayoutNode, Map<string, boolean>>;
  libraryTargets: Map<string, IndexedLayoutNode | null>;
  libraryNodesBySubjectId: Map<string, Set<OrganizerLayoutNode>>;
  libraryNodeMetadata: Map<OrganizerLayoutNode, LibraryLayoutNodeMetadata>;
  portableChildIdsByParentId: Map<string, string[]>;
  visualChildPathsByParentPath: Map<string, string[]>;
  visualOrderKeysByPath: Map<string, string[]>;
  seed: string;
}

type OrganizerLayoutNode = LayoutHeading | LayoutSubheading;

interface IndexedLayoutNode {
  node: OrganizerLayoutNode;
  membership: NoteOrganizerLayoutMembership;
  headingTitle: string;
}

interface LibraryLayoutNodeMetadata {
  libraryId: string;
  membership: NoteOrganizerLayoutMembership;
}

interface GroupUsage {
  total: number;
  nonIndex: number;
  libraryCounts: Map<string, number>;
}

interface SubjectPlacement {
  groupId: string;
  indexed: boolean;
  libraryId: string | null;
  recordKind: RecordKind;
}

interface MutationTracker {
  changed: boolean;
  portableIdentity: NoteOrganizerDiff["portableIdentity"];
}

function fail(message: string): never {
  throw new Error(message);
}

function safeStableId(value: unknown, label: string): string {
  if (typeof value !== "string") fail(`${label} must be text.`);
  const id = value.trim();
  if (!id || id.length > 128 || !/^[a-z0-9][a-z0-9._:@+-]*$/iu.test(id) || !isSafeObjectKey(id)) {
    fail(`${label} has an invalid stable ID.`);
  }
  return id;
}

function safeText(value: unknown, label: string, maximum: number, allowEmpty = false): string {
  if (typeof value !== "string") fail(`${label} must be text.`);
  const text = value.trim().normalize("NFC");
  if ((!allowEmpty && !text) || text.length > maximum || /[\p{Cc}\p{Cf}]/u.test(text)) {
    fail(`${label} is invalid or too long.`);
  }
  return text;
}

function safePath(value: unknown, label: string): string {
  if (typeof value !== "string") fail(`${label} must be text.`);
  const path = value.normalize("NFC");
  if (!path || path.length > MAX_TRANSFER_TEXT_LENGTH || path !== path.trim()
    || path.startsWith("/") || path.includes("\\") || /[\p{Cc}\p{Cf}]/u.test(path)) {
    fail(`${label} is not a safe vault-relative path.`);
  }
  const segments = path.split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === "..")) {
    fail(`${label} is not a safe vault-relative path.`);
  }
  if (!path.toLowerCase().endsWith(".md")) fail(`${label} must identify a Markdown note.`);
  return path;
}

function safeNonNegativeInteger(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    fail(`${label} must be a non-negative integer.`);
  }
  return value;
}

function pairKey(baseId: string, path: string): string {
  return `${baseId}\0${path}`;
}

function targetKey(target: Pick<NoteOrganizerCollectionTarget, "headingId" | "subheadingId">): string {
  return `${target.headingId}\0${target.subheadingId ?? ""}`;
}

function comparePair(left: Pick<NoteOrganizerFileFact, "baseId" | "path">, right: Pick<NoteOrganizerFileFact, "baseId" | "path">): number {
  return codeUnitCompare(left.baseId, right.baseId) || codeUnitCompare(left.path, right.path);
}

function normalizeFact(rawInput: unknown, index: number): NoteOrganizerFileFact {
  if (!rawInput || typeof rawInput !== "object" || Array.isArray(rawInput)) {
    fail(`Selected file fact ${index + 1} is invalid.`);
  }
  const input = rawInput as Record<string, unknown>;
  const baseId = safeStableId(input.baseId, `Selected file fact ${index + 1} base`);
  const path = safePath(input.path, `Selected file fact ${index + 1} path`);
  if (input.exists !== true || input.markdown !== true || input.eligible !== true) {
    fail(`“${path}” is not an existing eligible Markdown note.`);
  }
  if (isImmutableSourcePath(path)) fail(`“${path}” is an immutable source-book note and cannot be organized.`);
  const sourceKind = input.sourceKind;
  if (typeof sourceKind !== "string" || !RECORD_KINDS.includes(sourceKind as RecordKind)) {
    fail(`“${path}” has an unsupported source kind.`);
  }
  const sourceRole = input.sourceRole;
  if (typeof sourceRole !== "string" || !RECORD_ROLES.includes(sourceRole as RecordRole) || sourceRole === "placeholder") {
    fail(`“${path}” has an unsupported source role for an existing Markdown note.`);
  }
  if (typeof input.indexEligible !== "boolean") fail(`“${path}” has an invalid Index-eligibility fact.`);
  return {
    path,
    baseId,
    title: safeText(input.title, `Selected file fact ${index + 1} title`, MAX_TRANSFER_TEXT_LENGTH),
    mtime: safeNonNegativeInteger(input.mtime, `Selected file fact ${index + 1} modified time`),
    size: safeNonNegativeInteger(input.size, `Selected file fact ${index + 1} size`),
    exists: true,
    markdown: true,
    eligible: true,
    sourceKind: sourceKind as RecordKind,
    sourceRole: sourceRole as RecordRole,
    configuredId: safeText(
      input.configuredId,
      `Selected file fact ${index + 1} configured ID`,
      MAX_TRANSFER_TEXT_LENGTH,
      true,
    ),
    indexEligible: input.indexEligible,
    suggestedIndexGroup: safeText(
      input.suggestedIndexGroup,
      `Selected file fact ${index + 1} suggested Index group`,
      MAX_ORGANIZATION_LABEL_LENGTH,
      true,
    ),
  };
}

function normalizeFacts(inputs: readonly NoteOrganizerFileFact[]): NoteOrganizerFileFact[] {
  if (!Array.isArray(inputs) || inputs.length < 1 || inputs.length > MAX_NOTE_ORGANIZER_DIRECTIVES) {
    fail(`Choose between 1 and ${MAX_NOTE_ORGANIZER_DIRECTIVES.toLocaleString()} note/base destinations.`);
  }
  const facts: NoteOrganizerFileFact[] = [];
  let textBytes = 0;
  for (const [index, input] of inputs.entries()) {
    const normalized = normalizeFact(input, index);
    textBytes += utf8Encoder.encode([
      normalized.path,
      normalized.baseId,
      normalized.title,
      normalized.configuredId,
      normalized.suggestedIndexGroup,
    ].join("\0")).byteLength;
    if (textBytes > MAX_NOTE_ORGANIZER_INPUT_TEXT_BYTES) {
      fail("Selected note facts exceed the 8 MB text safety limit. Organize fewer notes at once.");
    }
    facts.push(normalized);
  }
  facts.sort(comparePair);
  const keys = new Set<string>();
  const paths = new Set<string>();
  for (const fact of facts) {
    const key = pairKey(fact.baseId, fact.path);
    if (keys.has(key)) fail(`“${fact.path}” has duplicate facts for knowledge base ${fact.baseId}.`);
    keys.add(key);
    paths.add(fact.path);
  }
  if (paths.size > MAX_NOTE_ORGANIZER_NOTES) {
    fail(`Choose at most ${MAX_NOTE_ORGANIZER_NOTES.toLocaleString()} Markdown notes at once.`);
  }
  return facts;
}

function normalizePrimary(input: NoteOrganizerPrimaryDirective | undefined, label: string): NoteOrganizerPrimaryDirective {
  if (input === undefined) return { mode: "keep" };
  if (!input || typeof input !== "object") fail(`${label} primary action is invalid.`);
  if (input.mode === "keep" || input.mode === "none") return { mode: input.mode };
  if (input.mode === "index") {
    const groupTitle = input.groupTitle === undefined
      ? undefined
      : safeText(input.groupTitle, `${label} Index group`, MAX_ORGANIZATION_LABEL_LENGTH, true) || undefined;
    return groupTitle ? { mode: "index", groupTitle } : { mode: "index" };
  }
  if (input.mode === "library") {
    const libraryId = safeStableId(input.libraryId, `${label} Library`);
    const headingId = input.headingId === undefined
      ? undefined
      : safeStableId(input.headingId, `${label} Library heading`);
    const subheadingId = input.subheadingId === undefined
      ? undefined
      : safeStableId(input.subheadingId, `${label} Library subheading`);
    if (subheadingId && !headingId) fail(`${label} must identify the Library heading that owns its subheading.`);
    return {
      mode: "library",
      libraryId,
      ...(headingId ? { headingId } : {}),
      ...(subheadingId ? { subheadingId } : {}),
    };
  }
  return fail(`${label} primary action is unsupported.`);
}

function normalizeCollectionTargets(
  inputs: readonly NoteOrganizerCollectionTarget[],
  label: string,
): NoteOrganizerCollectionTarget[] {
  if (!Array.isArray(inputs)) fail(`${label} Collection targets must be a list.`);
  const output: NoteOrganizerCollectionTarget[] = [];
  const used = new Set<string>();
  for (const [index, rawInput] of inputs.entries()) {
    if (!rawInput || typeof rawInput !== "object") fail(`${label} Collection target ${index + 1} is invalid.`);
    const input = rawInput as Record<string, unknown>;
    const headingId = safeStableId(input.headingId, `${label} Collection heading ${index + 1}`);
    const subheadingId = input.subheadingId === undefined
      ? undefined
      : safeStableId(input.subheadingId, `${label} Collection subheading ${index + 1}`);
    const target = { headingId, ...(subheadingId ? { subheadingId } : {}) };
    const key = targetKey(target);
    if (used.has(key)) continue;
    used.add(key);
    output.push(target);
  }
  return output.sort((left, right) => codeUnitCompare(targetKey(left), targetKey(right)));
}

function normalizeCollections(
  input: NoteOrganizerCollectionsDirective | undefined,
  label: string,
): NoteOrganizerCollectionsDirective {
  if (input === undefined) return { mode: "keep" };
  if (!input || typeof input !== "object") fail(`${label} Collections action is invalid.`);
  if (input.mode === "keep") return { mode: "keep" };
  if (input.mode !== "add" && input.mode !== "replace") fail(`${label} Collections action is unsupported.`);
  const targets = normalizeCollectionTargets(input.targets, label);
  if (input.mode === "add" && targets.length === 0) fail(`${label} Add requires at least one Collection target.`);
  return { mode: input.mode, targets };
}

function normalizeDirectives(inputs: readonly NoteOrganizerDirective[]): NormalizedDirective[] {
  if (!Array.isArray(inputs) || inputs.length < 1 || inputs.length > MAX_NOTE_ORGANIZER_DIRECTIVES) {
    fail(`Choose between 1 and ${MAX_NOTE_ORGANIZER_DIRECTIVES.toLocaleString()} note/base directives.`);
  }
  const output: NormalizedDirective[] = [];
  const used = new Set<string>();
  let targetCount = 0;
  let textBytes = 0;
  for (const [index, rawInput] of inputs.entries()) {
    if (!rawInput || typeof rawInput !== "object") fail(`Note organizer directive ${index + 1} is invalid.`);
    const input = rawInput as Record<string, unknown>;
    const path = safePath(input.path, `Note organizer directive ${index + 1} path`);
    const baseId = safeStableId(input.baseId, `Note organizer directive ${index + 1} base`);
    const label = `Directive for “${path}”`;
    const primary = normalizePrimary(input.primary as NoteOrganizerPrimaryDirective | undefined, label);
    const collections = normalizeCollections(input.collections as NoteOrganizerCollectionsDirective | undefined, label);
    const key = pairKey(baseId, path);
    if (used.has(key)) fail(`“${path}” has more than one directive for knowledge base ${baseId}.`);
    used.add(key);
    targetCount += collections.mode === "keep" ? 0 : collections.targets.length;
    if (targetCount > MAX_NOTE_ORGANIZER_COLLECTION_TARGETS) {
      fail(`Choose at most ${MAX_NOTE_ORGANIZER_COLLECTION_TARGETS.toLocaleString()} Collection targets at once.`);
    }
    const normalized = { path, baseId, primary, collections };
    textBytes += utf8Encoder.encode(canonicalJsonString(normalized)).byteLength;
    if (textBytes > MAX_NOTE_ORGANIZER_INPUT_TEXT_BYTES) {
      fail("Note organizer directives exceed the 8 MB text safety limit. Organize fewer notes at once.");
    }
    output.push(normalized);
  }
  return output.sort(comparePair);
}

function fingerprint(value: unknown): string {
  return fingerprintText(typeof value === "string" ? value : canonicalJsonString(value));
}

/**
 * Stable store-identity guard. Destination entries have their own exact full
 * guards, so an unrelated base edit or active-base switch need not invalidate
 * a safe cross-base preview.
 */
export function noteOrganizerStoreGuard(store: PluginStore): string {
  return fingerprint({
    kind: store.kind,
    version: store.version,
    vaultId: store.vaultId,
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

function baseGuard(entry: KnowledgeBaseEntry): NoteOrganizerBaseGuard {
  const semanticFingerprint = semanticEntryFingerprint(entry);
  if (entry.semanticHash !== semanticFingerprint) {
    fail(`Knowledge base “${entry.data.settings.workspaceName}” has an untrusted semantic hash. Reload or repair it before organizing notes.`);
  }
  if (!Number.isSafeInteger(entry.semanticRevision) || entry.semanticRevision < 0) {
    fail(`Knowledge base “${entry.data.settings.workspaceName}” has an invalid semantic revision.`);
  }
  return {
    baseId: entry.id,
    baseName: entry.data.settings.workspaceName,
    entryGuard: entryGuard(entry),
    semanticFingerprint,
    semanticRevision: entry.semanticRevision,
    semanticHead: entry.semanticHead,
    semanticHash: entry.semanticHash,
  };
}

function forEachLayoutNode(
  headings: readonly LayoutHeading[],
  visit: (node: LayoutHeading | LayoutSubheading, heading: LayoutHeading, labels: readonly string[]) => void,
): void {
  for (const heading of headings) {
    visit(heading, heading, [heading.title]);
    const stack: Array<{ node: LayoutSubheading; labels: string[] }> = [];
    for (let index = heading.subheadings.length - 1; index >= 0; index -= 1) {
      const node = heading.subheadings[index];
      if (node) stack.push({ node, labels: [heading.title, node.title] });
    }
    while (stack.length > 0) {
      const current = stack.pop();
      if (!current) continue;
      visit(current.node, heading, current.labels);
      const children = childSubheadings(current.node);
      for (let index = children.length - 1; index >= 0; index -= 1) {
        const child = children[index];
        if (child) stack.push({ node: child, labels: [...current.labels, child.title] });
      }
    }
  }
}

function indexLayoutTargets(
  layout: readonly LayoutHeading[],
  prefix: string,
  targets: Map<string, IndexedLayoutNode | null>,
  metadata: Map<OrganizerLayoutNode, NoteOrganizerLayoutMembership>,
  nodesBySubject: Map<string, Set<OrganizerLayoutNode>>,
): void {
  const headingCounts = new Map<string, number>();
  for (const heading of layout) headingCounts.set(heading.id, (headingCounts.get(heading.id) ?? 0) + 1);
  const keysByHeading = new Map<string, string[]>();
  forEachLayoutNode(layout, (node, heading, labels) => {
    const membership: NoteOrganizerLayoutMembership = {
      headingId: heading.id,
      ...(node === heading ? {} : { subheadingId: node.id }),
      label: labels.join(" / "),
    };
    const key = `${prefix}${targetKey(membership)}`;
    const headingKeys = keysByHeading.get(heading.id) ?? [];
    headingKeys.push(key);
    keysByHeading.set(heading.id, headingKeys);
    if (targets.has(key)) targets.set(key, null);
    else targets.set(key, { node, membership, headingTitle: heading.title });
    metadata.set(node, membership);
    for (const subject of node.subjects) {
      const nodes = nodesBySubject.get(subject) ?? new Set<OrganizerLayoutNode>();
      nodes.add(node);
      nodesBySubject.set(subject, nodes);
    }
  });
  for (const [headingId, count] of headingCounts) {
    if (count < 2) continue;
    for (const key of keysByHeading.get(headingId) ?? []) targets.set(key, null);
  }
}

function resolveLayoutTarget(
  targets: ReadonlyMap<string, IndexedLayoutNode | null>,
  key: string,
  label: string,
): IndexedLayoutNode {
  if (!targets.has(key)) fail(`${label} is no longer available.`);
  const located = targets.get(key);
  if (!located) fail(`${label} is ambiguous. Repair duplicate layout IDs before organizing notes.`);
  return located;
}

function validateDirective(
  entry: KnowledgeBaseEntry,
  fact: NoteOrganizerFileFact,
  directive: NormalizedDirective,
  context: BaseMutationContext,
): void {
  if (directive.primary.mode === "index"
    && entry.data.settings.workspaceMode === "ent-clinical"
    && !fact.indexEligible) {
    fail(`“${fact.title}” is source-classified as ${fact.sourceKind} and cannot enter the protected ${entry.data.settings.indexLabel}.`);
  }
  if (directive.primary.mode === "index"
    && entry.data.settings.workspaceMode === "ent-clinical"
    && !entry.data.settings.allowClinicalVisualGroupMoves) {
    const sourceGroup = fact.suggestedIndexGroup;
    if (!sourceGroup) {
      fail(`“${fact.title}” has no verifiable protected source group. Refresh its metadata before organizing it in the Index.`);
    }
    if (directive.primary.groupTitle
      && normalizedNameKey(directive.primary.groupTitle) !== normalizedNameKey(sourceGroup)) {
      fail(`Protected clinical grouping keeps “${fact.title}” in “${sourceGroup}”; it cannot be assigned to “${directive.primary.groupTitle}”.`);
    }
  }
  if (directive.primary.mode === "library") {
    const library = context.libraryById.get(directive.primary.libraryId) ?? null;
    if (!library) fail(`The destination Library ${directive.primary.libraryId} is no longer available.`);
    if (library.archivedAt !== null) fail(`Library “${library.name}” is archived. Restore it before organizing notes there.`);
    if (entry.data.settings.workspaceMode === "ent-clinical"
      && library.sourceKind !== null
      && library.sourceKind !== fact.sourceKind) {
      fail(`Protected Library “${library.name}” accepts ${library.sourceKind} notes; “${fact.title}” is source-classified as ${fact.sourceKind}.`);
    }
    if (directive.primary.headingId) {
      resolveLayoutTarget(
        context.libraryTargets,
        `${library.id}\0${targetKey({
          headingId: directive.primary.headingId,
          ...(directive.primary.subheadingId ? { subheadingId: directive.primary.subheadingId } : {}),
        })}`,
        `Library destination for “${fact.title}”`,
      );
    }
  }
  if (directive.primary.mode !== "keep") {
    const owners = context.ownerIdsByPath.get(fact.path) ?? [];
    if (owners.length > 1) fail(`“${fact.title}” has more than one portable identity in “${entry.data.settings.workspaceName}”. Repair it before organizing the note.`);
    if (owners.length === 1 && !context.subjectById.has(owners[0] ?? "")) {
      fail(`“${fact.title}” has a dangling portable identity in “${entry.data.settings.workspaceName}”. Repair it before organizing the note.`);
    }
    assertSingleActiveLibraryPlacement(context, fact);
    if (!primaryDirectiveIsExactNoOp(context, fact, directive.primary, currentOwner(context, fact.path))) {
      assertNoDependentHierarchy(context, fact, directive.primary);
    }
  }
  if (directive.collections.mode !== "keep") {
    for (const target of directive.collections.targets) {
      resolveLayoutTarget(
        context.collectionTargets,
        targetKey(target),
        `Collection destination for “${fact.title}”`,
      );
    }
  }
}

function assertSingleActiveLibraryPlacement(
  context: BaseMutationContext,
  fact: NoteOrganizerFileFact,
): void {
  const subject = currentOwner(context, fact.path);
  if (!subject) return;
  const libraryId = subjectLibraryId(subject);
  const placements = [...(context.libraryNodesBySubjectId.get(subject.id) ?? [])]
    .map((node) => context.libraryNodeMetadata.get(node))
    .filter((metadata): metadata is LibraryLayoutNodeMetadata => Boolean(metadata));
  const foreignPlacement = placements.find((metadata) => metadata.libraryId !== libraryId);
  if (foreignPlacement) {
    const foreignName = context.libraryById.get(foreignPlacement.libraryId)?.name ?? foreignPlacement.libraryId;
    const storedName = libraryId
      ? context.libraryById.get(libraryId)?.name ?? libraryId
      : subject.indexed
        ? "the Index"
        : "no Library";
    fail(
      `“${fact.title}” has a stale layout reference in Library “${foreignName}” outside its stored placement in ${storedName}. Repair the stale Library placement before organizing the note.`,
    );
  }
  if (!libraryId) return;
  const activePlacements = placements.filter((metadata) => metadata.libraryId === libraryId);
  if (activePlacements.length <= 1) return;
  const libraryName = context.libraryById.get(libraryId)?.name ?? libraryId;
  fail(
    `“${fact.title}” has more than one active layout placement in Library “${libraryName}”. Repair the duplicate Library placement before organizing the note.`,
  );
}

function placementOf(subject: PortableSubjectDefinition): SubjectPlacement {
  return {
    groupId: subject.groupId,
    indexed: subject.indexed,
    libraryId: subjectLibraryId(subject),
    recordKind: subject.recordKind,
  };
}

function adjustGroupUsage(
  usageById: Map<string, GroupUsage>,
  placement: SubjectPlacement,
  delta: 1 | -1,
): void {
  const usage = usageById.get(placement.groupId) ?? {
    total: 0,
    nonIndex: 0,
    libraryCounts: new Map<string, number>(),
  };
  usage.total += delta;
  if (!placement.indexed) usage.nonIndex += delta;
  if (placement.libraryId) {
    const next = (usage.libraryCounts.get(placement.libraryId) ?? 0) + delta;
    if (next === 0) usage.libraryCounts.delete(placement.libraryId);
    else usage.libraryCounts.set(placement.libraryId, next);
  }
  usageById.set(placement.groupId, usage);
}

function addStringMapValue(map: Map<string, string[]>, key: string, value: string): void {
  const values = map.get(key) ?? [];
  values.push(value);
  map.set(key, values);
}

function createBaseContext(
  entry: KnowledgeBaseEntry,
  facts: readonly NoteOrganizerFileFact[],
  seed: string,
): BaseMutationContext {
  const data = entry.data;
  const subjectById = new Map(data.portableIndex.subjects.map((subject) => [subject.id, subject]));
  const ownerIdsByPath = new Map<string, string[]>();
  for (const [subjectId, path] of Object.entries(data.portableIndex.resolvedPathBySubjectId)) {
    if (!path) continue;
    const owners = ownerIdsByPath.get(path) ?? [];
    owners.push(subjectId);
    ownerIdsByPath.set(path, owners);
  }
  const groupIdsByName = new Map<string, string[]>();
  for (const group of data.portableIndex.groups) {
    addStringMapValue(groupIdsByName, normalizedNameKey(group.title), group.id);
  }
  const groupUsageById = new Map<string, GroupUsage>();
  for (const subject of data.portableIndex.subjects) adjustGroupUsage(groupUsageById, placementOf(subject), 1);

  const collectionTargets = new Map<string, IndexedLayoutNode | null>();
  const collectionNodesByPath = new Map<string, Set<OrganizerLayoutNode>>();
  const collectionNodeMetadata = new Map<OrganizerLayoutNode, NoteOrganizerLayoutMembership>();
  indexLayoutTargets(
    data.collections,
    "",
    collectionTargets,
    collectionNodeMetadata,
    collectionNodesByPath,
  );
  const collectionSubjectCountsByNode = new Map<OrganizerLayoutNode, Map<string, number>>();
  for (const node of collectionNodeMetadata.keys()) {
    const counts = new Map<string, number>();
    for (const path of node.subjects) counts.set(path, (counts.get(path) ?? 0) + 1);
    collectionSubjectCountsByNode.set(node, counts);
  }

  const libraryTargets = new Map<string, IndexedLayoutNode | null>();
  const libraryNodesBySubjectId = new Map<string, Set<OrganizerLayoutNode>>();
  const libraryNodeMetadata = new Map<OrganizerLayoutNode, LibraryLayoutNodeMetadata>();
  for (const [libraryId, layout] of Object.entries(data.portableIndex.libraryLayouts)) {
    const nodeMetadata = new Map<OrganizerLayoutNode, NoteOrganizerLayoutMembership>();
    indexLayoutTargets(
      layout,
      `${libraryId}\0`,
      libraryTargets,
      nodeMetadata,
      libraryNodesBySubjectId,
    );
    for (const [node, membership] of nodeMetadata) {
      libraryNodeMetadata.set(node, { libraryId, membership });
    }
  }

  const portableChildIdsByParentId = new Map<string, string[]>();
  for (const subject of data.portableIndex.subjects) {
    if (subject.parentId) addStringMapValue(portableChildIdsByParentId, subject.parentId, subject.id);
  }
  const visualChildPathsByParentPath = new Map<string, string[]>();
  for (const [childPath, parentPath] of Object.entries(data.curriculumVisual.parentByPath)) {
    if (parentPath) addStringMapValue(visualChildPathsByParentPath, parentPath, childPath);
  }
  const visualOrderKeysByPath = new Map<string, string[]>();
  for (const [key, paths] of Object.entries(data.curriculumVisual.orderByContainer)) {
    for (const path of paths) addStringMapValue(visualOrderKeysByPath, path, key);
  }
  return {
    entry,
    factByPath: new Map(facts.map((fact) => [fact.path, fact])),
    subjectById,
    libraryById: new Map(data.portableIndex.libraries.map((library) => [library.id, library])),
    ownerIdsByPath,
    usedSubjectIds: new Set(data.portableIndex.subjects.map((subject) => subject.id)),
    usedGroupIds: new Set(data.portableIndex.groups.map((group) => group.id)),
    groupById: new Map(data.portableIndex.groups.map((group) => [group.id, group])),
    groupIdsByName,
    groupUsageById,
    directIndexPaths: new Set(data.directIndexPaths),
    manualIndexPaths: new Set(data.manualIndexPaths),
    excludedIndexPaths: new Set(data.excludedIndexPaths),
    indexGroupOrderNames: new Set(data.indexGroupOrder.map(normalizedNameKey)),
    collectionTargets,
    collectionNodesByPath,
    collectionNodeMetadata,
    collectionSubjectCountsByNode,
    collectionDesiredMembershipByNode: new Map(),
    libraryTargets,
    libraryNodesBySubjectId,
    libraryNodeMetadata,
    portableChildIdsByParentId,
    visualChildPathsByParentPath,
    visualOrderKeysByPath,
    seed,
  };
}

function stableAllocatedId(prefix: string, parts: readonly string[], used: Set<string>): string {
  const root = `${prefix}-${fingerprint(parts)}`;
  let id = root;
  let suffix = 2;
  while (used.has(id)) {
    id = `${root}-${suffix}`;
    suffix += 1;
  }
  used.add(id);
  return id;
}

function mark(tracker: MutationTracker): void {
  tracker.changed = true;
}

function replaceList(
  current: string[],
  next: string[],
  assign: (value: string[]) => void,
  tracker: MutationTracker,
): void {
  if (current.length === next.length && current.every((value, index) => value === next[index])) return;
  assign(next);
  mark(tracker);
}

function automaticIndexSource(context: BaseMutationContext, path: string): boolean {
  const data = context.entry.data;
  if (context.excludedIndexPaths.has(path)) return false;
  return data.settings.workspaceMode === "ent-clinical"
    ? pathIsInsideFolder(path, data.settings.primaryFolder)
    : pathIsInIndexFolderSources(path, data.indexFolderSources);
}

function setDirectMembership(
  context: BaseMutationContext,
  path: string,
  indexed: boolean,
  tracker: MutationTracker,
): void {
  const data = context.entry.data;
  if (indexed) {
    if (!context.directIndexPaths.has(path)) {
      context.directIndexPaths.add(path);
      data.directIndexPaths.push(path);
      mark(tracker);
    }
    if (context.manualIndexPaths.delete(path)) mark(tracker);
    if (context.excludedIndexPaths.delete(path)) mark(tracker);
    return;
  }
  if (context.directIndexPaths.delete(path)) mark(tracker);
  if (context.manualIndexPaths.delete(path)) mark(tracker);
  const suppliedByFolder = data.settings.workspaceMode === "ent-clinical"
    ? pathIsInsideFolder(path, data.settings.primaryFolder)
    : pathIsInIndexFolderSources(path, data.indexFolderSources);
  if (suppliedByFolder && !context.excludedIndexPaths.has(path)) {
    context.excludedIndexPaths.add(path);
    data.excludedIndexPaths.push(path);
    mark(tracker);
  }
}

function flushMembershipSets(context: BaseMutationContext): void {
  const data = context.entry.data;
  data.directIndexPaths = data.directIndexPaths.filter((path) => context.directIndexPaths.has(path));
  data.manualIndexPaths = data.manualIndexPaths.filter((path) => context.manualIndexPaths.has(path));
  data.excludedIndexPaths = data.excludedIndexPaths.filter((path) => context.excludedIndexPaths.has(path));
}

function setMapValue(map: Record<string, string>, key: string, value: string, tracker: MutationTracker): void {
  if (map[key] === value) return;
  map[key] = value;
  mark(tracker);
}

function deleteMapValue(map: Record<string, string>, key: string, tracker: MutationTracker): void {
  if (!Object.prototype.hasOwnProperty.call(map, key)) return;
  delete map[key];
  mark(tracker);
}

function resetVisualPlacement(context: BaseMutationContext, path: string, tracker: MutationTracker): void {
  const data = context.entry.data;
  if (Object.prototype.hasOwnProperty.call(data.curriculumVisual.parentByPath, path)) {
    delete data.curriculumVisual.parentByPath[path];
    mark(tracker);
  }
  for (const key of context.visualOrderKeysByPath.get(path) ?? []) {
    if (!Object.prototype.hasOwnProperty.call(data.curriculumVisual.orderByContainer, key)) continue;
    // Match resetCurriculumVisualPath: one explicit sibling order is a unit.
    delete data.curriculumVisual.orderByContainer[key];
    mark(tracker);
  }
}

function setSubjectLibraryLayoutPlacement(
  context: BaseMutationContext,
  subjectId: string,
  targetNode: OrganizerLayoutNode | null,
  tracker: MutationTracker,
): void {
  const touched = new Set(context.libraryNodesBySubjectId.get(subjectId) ?? []);
  if (targetNode) touched.add(targetNode);
  for (const node of touched) {
    const next = node === targetNode
      // Library placement is effective membership. Preserve any legacy
      // duplicate occurrences already present in the retained node so an
      // exact-looking move cannot perform an undisclosed repair.
      ? !node.subjects.includes(subjectId)
        ? [...node.subjects, subjectId]
        : node.subjects
      : node.subjects.filter((candidate) => candidate !== subjectId);
    replaceList(node.subjects, next, (value) => { node.subjects = value; }, tracker);
  }
  if (targetNode) context.libraryNodesBySubjectId.set(subjectId, new Set([targetNode]));
  else context.libraryNodesBySubjectId.delete(subjectId);
}

function currentOwner(context: BaseMutationContext, path: string): PortableSubjectDefinition | null {
  const owners = context.ownerIdsByPath.get(path) ?? [];
  if (owners.length !== 1) return null;
  return context.subjectById.get(owners[0] ?? "") ?? null;
}

function ensureSubject(
  context: BaseMutationContext,
  fact: NoteOrganizerFileFact,
  library: LibraryDefinition | null,
  groupId: string,
  tracker: MutationTracker,
): PortableSubjectDefinition {
  const existing = currentOwner(context, fact.path);
  if (existing) {
    tracker.portableIdentity = "reused";
    return existing;
  }
  const id = stableAllocatedId("subject-organizer", [context.seed, context.entry.id, fact.path], context.usedSubjectIds);
  const recordKind: RecordKind = library?.sourceKind
    ?? (library ? fact.sourceKind : fact.sourceKind === "note" ? "topic" : fact.sourceKind);
  const subject: PortableSubjectDefinition = {
    id,
    title: fact.title,
    groupId,
    parentId: null,
    order: context.entry.data.portableIndex.subjects.length,
    indexed: library === null,
    configuredId: fact.configuredId,
    recordKind,
    libraryId: library?.id ?? null,
  };
  context.entry.data.portableIndex.subjects.push(subject);
  context.entry.data.portableIndex.resolvedPathBySubjectId[id] = fact.path;
  context.subjectById.set(id, subject);
  context.ownerIdsByPath.set(fact.path, [id]);
  tracker.portableIdentity = "created";
  mark(tracker);
  return subject;
}

function ensureIndexGroup(
  context: BaseMutationContext,
  title: string,
  tracker: MutationTracker,
): string {
  const data = context.entry.data;
  const key = normalizedNameKey(title);
  for (const id of context.groupIdsByName.get(key) ?? []) {
    if ((context.groupUsageById.get(id)?.nonIndex ?? 0) === 0) return id;
  }
  const id = stableAllocatedId("group-organizer", [context.seed, context.entry.id, "index", title], context.usedGroupIds);
  const group = { id, title, order: data.portableIndex.groups.length };
  data.portableIndex.groups.push(group);
  context.groupById.set(id, group);
  addStringMapValue(context.groupIdsByName, key, id);
  mark(tracker);
  return id;
}

function ensureLibraryGroup(
  context: BaseMutationContext,
  library: LibraryDefinition,
  title: string,
  tracker: MutationTracker,
): string {
  const data = context.entry.data;
  const key = normalizedNameKey(title);
  for (const id of context.groupIdsByName.get(key) ?? []) {
    const usage = context.groupUsageById.get(id);
    const targetCount = usage?.libraryCounts.get(library.id) ?? 0;
    if (targetCount > 0 && usage?.total === targetCount) return id;
  }
  const id = stableAllocatedId(
    "group-organizer",
    [context.seed, context.entry.id, library.id, title],
    context.usedGroupIds,
  );
  const group = { id, title, order: data.portableIndex.groups.length };
  data.portableIndex.groups.push(group);
  context.groupById.set(id, group);
  addStringMapValue(context.groupIdsByName, key, id);
  mark(tracker);
  return id;
}

function reconcileSubjectPlacement(
  context: BaseMutationContext,
  before: SubjectPlacement | null,
  subject: PortableSubjectDefinition,
): void {
  if (before) adjustGroupUsage(context.groupUsageById, before, -1);
  adjustGroupUsage(context.groupUsageById, placementOf(subject), 1);
}

function assignSubjectField<K extends keyof PortableSubjectDefinition>(
  subject: PortableSubjectDefinition,
  key: K,
  value: PortableSubjectDefinition[K],
  tracker: MutationTracker,
): void {
  if (subject[key] === value) return;
  subject[key] = value;
  mark(tracker);
}

function isEffectivelyIndexed(
  context: BaseMutationContext,
  fact: NoteOrganizerFileFact,
  subject: PortableSubjectDefinition | null,
): boolean {
  const data = context.entry.data;
  if (data.settings.workspaceMode === "ent-clinical") {
    if (!fact.indexEligible) return false;
    if (fact.sourceRole === "library" && isLibraryKind(fact.sourceKind)) return false;
  }
  if (subject && !subject.indexed) {
    const libraryId = subjectLibraryId(subject);
    const library = libraryId ? context.libraryById.get(libraryId) : null;
    if (library?.archivedAt === null) return false;
  }
  if (subject?.indexed) return true;
  if (context.directIndexPaths.has(fact.path) || context.manualIndexPaths.has(fact.path)) return true;
  return automaticIndexSource(context, fact.path);
}

function assertNoDependentHierarchy(
  context: BaseMutationContext,
  fact: NoteOrganizerFileFact,
  directive: NoteOrganizerPrimaryDirective,
): void {
  if (directive.mode === "keep") return;
  const data = context.entry.data;
  const subject = currentOwner(context, fact.path);
  const refuse = (detail: string): never => fail(
    `Cannot reorganize “${fact.title}” because ${detail}. Detach or reorganize that hierarchy first; the Organizer will not silently change related notes.`,
  );
  if (subject?.parentId) {
    const parent = context.subjectById.get(subject.parentId);
    refuse(`it is nested under “${parent?.title || subject.parentId}”`);
  }
  if (Object.prototype.hasOwnProperty.call(data.curriculumVisual.parentByPath, fact.path)) {
    const parentPath = data.curriculumVisual.parentByPath[fact.path];
    refuse(parentPath ? `its visual parent is “${parentPath}”` : "it has an explicit visual root placement");
  }
  const orderKeys = (context.visualOrderKeysByPath.get(fact.path) ?? [])
    .filter((key) => Object.prototype.hasOwnProperty.call(data.curriculumVisual.orderByContainer, key));
  if (orderKeys.length > 0) refuse(`it participates in the visual sibling order “${orderKeys[0]}”`);

  const portableChildId = subject ? context.portableChildIdsByParentId.get(subject.id)?.[0] : undefined;
  if (portableChildId) {
    const child = context.subjectById.get(portableChildId);
    refuse(`dependent child “${child?.title || portableChildId}” is attached to it`);
  }
  const visualChildPath = context.visualChildPathsByParentPath.get(fact.path)?.[0];
  if (visualChildPath) refuse(`dependent visual child “${visualChildPath}” is attached to it`);
  const childOrderKey = `parent:${fact.path}`;
  if (Object.prototype.hasOwnProperty.call(data.curriculumVisual.orderByContainer, childOrderKey)) {
    refuse(`dependent child order “${childOrderKey}” is attached to it`);
  }
}

function requestedIndexGroupTitle(
  context: BaseMutationContext,
  fact: NoteOrganizerFileFact,
  subject: PortableSubjectDefinition | null,
  directive: Extract<NoteOrganizerPrimaryDirective, { mode: "index" }>,
): string {
  const data = context.entry.data;
  const existingGroupTitle = subject?.indexed
    ? context.groupById.get(subject.groupId)?.title ?? ""
    : "";
  const protectedClinicalGroup = data.settings.workspaceMode === "ent-clinical"
    && !data.settings.allowClinicalVisualGroupMoves;
  return protectedClinicalGroup
    ? fact.suggestedIndexGroup
    : directive.groupTitle
      || data.indexGroupByPath[fact.path]
      || existingGroupTitle
      || fact.suggestedIndexGroup
      || "Ungrouped";
}

/** True only when Apply can preserve every hidden field behind the same projection. */
function primaryDirectiveIsExactNoOp(
  context: BaseMutationContext,
  fact: NoteOrganizerFileFact,
  directive: NoteOrganizerPrimaryDirective,
  subject: PortableSubjectDefinition | null,
): boolean {
  if (directive.mode === "keep") return true;
  const current = primaryState(context, fact, subject);
  if (directive.mode === "none") {
    if (current.kind === "none") return true;
    const protectedLibrary = protectedSourceLibrary(context, fact);
    return current.kind === "library"
      && current.placement === undefined
      && current.libraryId === protectedLibrary?.id;
  }
  if (directive.mode === "index") {
    if (current.kind !== "index"
      || current.groupTitle !== requestedIndexGroupTitle(context, fact, subject, directive)) return false;
    const automaticFolderOnly = subject === null
      && !context.directIndexPaths.has(fact.path)
      && !context.manualIndexPaths.has(fact.path)
      && automaticIndexSource(context, fact.path);
    // This one intentional strengthening creates a portable identity and
    // durable direct membership; the review surface discloses both effects.
    return !automaticFolderOnly;
  }
  if (current.kind !== "library" || current.libraryId !== directive.libraryId) return false;
  return directive.headingId
    ? current.placement?.headingId === directive.headingId
      && current.placement.subheadingId === directive.subheadingId
    : current.placement === undefined;
}

function applyPrimary(
  context: BaseMutationContext,
  fact: NoteOrganizerFileFact,
  directive: NoteOrganizerPrimaryDirective,
  tracker: MutationTracker,
): void {
  if (directive.mode === "keep") return;
  const data = context.entry.data;
  const existingSubject = currentOwner(context, fact.path);
  const beforePlacement = existingSubject ? placementOf(existingSubject) : null;
  if (primaryDirectiveIsExactNoOp(context, fact, directive, existingSubject)) return;
  if (directive.mode === "none") {
    if (existingSubject) {
      setSubjectLibraryLayoutPlacement(context, existingSubject.id, null, tracker);
      assignSubjectField(existingSubject, "indexed", false, tracker);
      assignSubjectField(existingSubject, "libraryId", null, tracker);
      assignSubjectField(existingSubject, "parentId", null, tracker);
      reconcileSubjectPlacement(context, beforePlacement, existingSubject);
      tracker.portableIdentity = "reused";
    }
    setDirectMembership(context, fact.path, false, tracker);
    deleteMapValue(data.indexGroupByPath, fact.path, tracker);
    resetVisualPlacement(context, fact.path, tracker);
    return;
  }
  if (directive.mode === "index") {
    const groupTitle = requestedIndexGroupTitle(context, fact, existingSubject, directive);
    const groupId = ensureIndexGroup(context, groupTitle, tracker);
    const subject = ensureSubject(context, fact, null, groupId, tracker);
    setSubjectLibraryLayoutPlacement(context, subject.id, null, tracker);
    assignSubjectField(subject, "indexed", true, tracker);
    assignSubjectField(subject, "libraryId", null, tracker);
    assignSubjectField(subject, "parentId", null, tracker);
    assignSubjectField(subject, "groupId", groupId, tracker);
    reconcileSubjectPlacement(context, beforePlacement, subject);
    setDirectMembership(context, fact.path, true, tracker);
    setMapValue(data.indexGroupByPath, fact.path, groupTitle, tracker);
    const groupNameKey = normalizedNameKey(groupTitle);
    if (!context.indexGroupOrderNames.has(groupNameKey)) {
      context.indexGroupOrderNames.add(groupNameKey);
      data.indexGroupOrder.push(groupTitle);
      mark(tracker);
    }
    resetVisualPlacement(context, fact.path, tracker);
    return;
  }
  const library = context.libraryById.get(directive.libraryId) ?? null;
  if (!library) return fail(`The destination Library ${directive.libraryId} is no longer available.`);
  const target = directive.headingId
    ? resolveLayoutTarget(
      context.libraryTargets,
      `${library.id}\0${targetKey({
        headingId: directive.headingId,
        ...(directive.subheadingId ? { subheadingId: directive.subheadingId } : {}),
      })}`,
      `Library destination for “${fact.title}”`,
    )
    : null;
  const groupTitle = target?.headingTitle ?? library.name;
  const groupId = ensureLibraryGroup(context, library, groupTitle, tracker);
  const subject = ensureSubject(context, fact, library, groupId, tracker);
  setSubjectLibraryLayoutPlacement(context, subject.id, target?.node ?? null, tracker);
  assignSubjectField(subject, "indexed", false, tracker);
  assignSubjectField(subject, "libraryId", library.id, tracker);
  assignSubjectField(subject, "parentId", null, tracker);
  assignSubjectField(subject, "groupId", groupId, tracker);
  if (data.settings.workspaceMode !== "ent-clinical" && library.sourceKind !== null) {
    assignSubjectField(subject, "recordKind", library.sourceKind, tracker);
  }
  reconcileSubjectPlacement(context, beforePlacement, subject);
  setDirectMembership(context, fact.path, false, tracker);
  deleteMapValue(data.indexGroupByPath, fact.path, tracker);
  resetVisualPlacement(context, fact.path, tracker);
}

function applyCollections(
  context: BaseMutationContext,
  path: string,
  directive: NoteOrganizerCollectionsDirective,
  tracker: MutationTracker,
): void {
  if (directive.mode === "keep") return;
  if (directive.mode === "replace") {
    const targets = new Set(directive.targets.map((target) => (
      resolveLayoutTarget(
        context.collectionTargets,
        targetKey(target),
        `Collection destination for “${path}”`,
      ).node
    )));
    const touched = new Set(context.collectionNodesByPath.get(path) ?? []);
    for (const node of targets) touched.add(node);
    for (const node of touched) {
      const desired = targets.has(node);
      const count = context.collectionSubjectCountsByNode.get(node)?.get(path) ?? 0;
      // Replace governs effective membership, not hidden cleanup. If legacy
      // state already contains duplicate occurrences in a retained target,
      // preserve them so an exact-looking review never performs an undisclosed
      // repair; Diagnostics can clean that corruption explicitly.
      if ((desired && count === 0) || (!desired && count > 0)) {
        const memberships = context.collectionDesiredMembershipByNode.get(node) ?? new Map<string, boolean>();
        memberships.set(path, desired);
        context.collectionDesiredMembershipByNode.set(node, memberships);
        mark(tracker);
      }
    }
    if (targets.size > 0) context.collectionNodesByPath.set(path, targets);
    else context.collectionNodesByPath.delete(path);
    return;
  }
  for (const target of directive.targets) {
    const located = resolveLayoutTarget(
      context.collectionTargets,
      targetKey(target),
      `Collection destination for “${path}”`,
    );
    const count = context.collectionSubjectCountsByNode.get(located.node)?.get(path) ?? 0;
    if (count === 0) {
      const memberships = context.collectionDesiredMembershipByNode.get(located.node) ?? new Map<string, boolean>();
      memberships.set(path, true);
      context.collectionDesiredMembershipByNode.set(located.node, memberships);
      const nodes = context.collectionNodesByPath.get(path) ?? new Set<OrganizerLayoutNode>();
      nodes.add(located.node);
      context.collectionNodesByPath.set(path, nodes);
      mark(tracker);
    }
  }
}

/** Apply all selected-note Collection membership changes in one scan per touched node. */
function flushCollectionMemberships(context: BaseMutationContext): void {
  for (const [node, desired] of context.collectionDesiredMembershipByNode) {
    const retained = new Set<string>();
    const next: string[] = [];
    for (const path of node.subjects) {
      const membership = desired.get(path);
      if (membership === false) continue;
      if (membership === true) {
        if (retained.has(path)) continue;
        retained.add(path);
      }
      next.push(path);
    }
    for (const [path, membership] of desired) {
      if (membership && !retained.has(path)) next.push(path);
    }
    node.subjects = next;
  }
}

function firstLibraryPlacement(
  context: BaseMutationContext,
  libraryId: string,
  subjectId: string,
): NoteOrganizerLayoutMembership | undefined {
  const memberships = [...(context.libraryNodesBySubjectId.get(subjectId) ?? [])]
    .map((node) => context.libraryNodeMetadata.get(node))
    .filter((metadata): metadata is LibraryLayoutNodeMetadata => metadata?.libraryId === libraryId)
    .map((metadata) => metadata.membership);
  return memberships.sort((left, right) => codeUnitCompare(targetKey(left), targetKey(right)))[0];
}

function protectedSourceLibrary(context: BaseMutationContext, fact: NoteOrganizerFileFact): LibraryDefinition | null {
  const data = context.entry.data;
  if (data.settings.workspaceMode !== "ent-clinical" || fact.sourceRole !== "library" || !isLibraryKind(fact.sourceKind)) {
    return null;
  }
  return [...context.libraryById.values()].find((library) => (
    library.archivedAt === null && library.sourceKind === fact.sourceKind
  )) ?? null;
}

function primaryState(
  context: BaseMutationContext,
  fact: NoteOrganizerFileFact,
  subject: PortableSubjectDefinition | null,
): NoteOrganizerPrimaryState {
  const data = context.entry.data;
  const protectedLibrary = protectedSourceLibrary(context, fact);
  if (subject) {
    if (subject.indexed) {
      if (!protectedLibrary && (data.settings.workspaceMode !== "ent-clinical" || fact.indexEligible)) {
        const groupTitle = data.indexGroupByPath[fact.path]
          || context.groupById.get(subject.groupId)?.title
          || fact.suggestedIndexGroup
          || "Ungrouped";
        return { kind: "index", groupTitle };
      }
    } else {
      const requestedLibraryId = subjectLibraryId(subject);
      const requestedLibrary = requestedLibraryId ? context.libraryById.get(requestedLibraryId) ?? null : null;
      const validLibrary = requestedLibrary
        && requestedLibrary.archivedAt === null
        && (data.settings.workspaceMode !== "ent-clinical"
          || requestedLibrary.sourceKind === null
          || requestedLibrary.sourceKind === fact.sourceKind)
        ? requestedLibrary
        : null;
      if (validLibrary) {
        const placement = firstLibraryPlacement(context, validLibrary.id, subject.id);
        return {
          kind: "library",
          libraryId: validLibrary.id,
          libraryName: validLibrary.name,
          ...(placement ? { placement } : {}),
          protectedSource: validLibrary.sourceKind !== null,
        };
      }
    }
  }
  if (protectedLibrary) {
    return {
      kind: "library",
      libraryId: protectedLibrary.id,
      libraryName: protectedLibrary.name,
      protectedSource: true,
    };
  }
  if ((data.settings.workspaceMode !== "ent-clinical" || fact.indexEligible)
    && isEffectivelyIndexed(context, fact, subject)) {
    return {
      kind: "index",
      groupTitle: data.indexGroupByPath[fact.path]
        || fact.suggestedIndexGroup
        || "Ungrouped",
    };
  }
  return { kind: "none" };
}

function collectionState(context: BaseMutationContext, path: string): NoteOrganizerLayoutMembership[] {
  const output = [...(context.collectionNodesByPath.get(path) ?? [])]
    .map((node) => context.collectionNodeMetadata.get(node))
    .filter((membership): membership is NoteOrganizerLayoutMembership => Boolean(membership));
  return output.sort((left, right) => codeUnitCompare(targetKey(left), targetKey(right)));
}

function membershipState(context: BaseMutationContext, fact: NoteOrganizerFileFact): NoteOrganizerMembershipState {
  const subject = currentOwner(context, fact.path);
  return {
    primary: primaryState(context, fact, subject),
    collections: collectionState(context, fact.path),
  };
}

function describePrimary(state: NoteOrganizerPrimaryState): string {
  if (state.kind === "none") return "No primary placement";
  if (state.kind === "index") return `Index — ${state.groupTitle}`;
  const placement = state.placement ? ` / ${state.placement.label}` : " / Unplaced";
  return `Library “${state.libraryName}”${placement}${state.protectedSource ? " (protected source)" : ""}`;
}

function targetMap(values: readonly NoteOrganizerLayoutMembership[]): Map<string, NoteOrganizerLayoutMembership> {
  return new Map(values.map((value) => [targetKey(value), value]));
}

function diffMemberships(
  before: readonly NoteOrganizerLayoutMembership[],
  after: readonly NoteOrganizerLayoutMembership[],
): { adds: NoteOrganizerLayoutMembership[]; removes: NoteOrganizerLayoutMembership[] } {
  const beforeMap = targetMap(before);
  const afterMap = targetMap(after);
  return {
    adds: after.filter((value) => !beforeMap.has(targetKey(value))),
    removes: before.filter((value) => !afterMap.has(targetKey(value))),
  };
}

function planPayload(plan: Omit<NoteOrganizerPlan, "planGuard">): unknown {
  return plan;
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  }
  return value;
}

function verifyFactsMatchDirectives(
  facts: readonly NoteOrganizerFileFact[],
  directives: readonly NormalizedDirective[],
): void {
  if (facts.length !== directives.length) {
    fail("Every note/base directive must have exactly one current selected-file fact, with no extra facts.");
  }
  for (let index = 0; index < facts.length; index += 1) {
    const fact = facts[index];
    const directive = directives[index];
    if (!fact || !directive || fact.path !== directive.path || fact.baseId !== directive.baseId) {
      fail("Selected-file facts do not exactly match the note/base directives.");
    }
  }
}

function validateStoreDestinations(
  store: PluginStore,
  facts: readonly NoteOrganizerFileFact[],
): { entries: Map<string, KnowledgeBaseEntry>; guards: NoteOrganizerBaseGuard[] } {
  const ids = [...new Set(facts.map((fact) => fact.baseId))].sort(codeUnitCompare);
  if (ids.length > MAX_KNOWLEDGE_BASES) fail(`Choose at most ${MAX_KNOWLEDGE_BASES} knowledge bases.`);
  const entries = new Map<string, KnowledgeBaseEntry>();
  const guards: NoteOrganizerBaseGuard[] = [];
  for (const id of ids) {
    const entry = store.bases.find((candidate) => candidate.id === id);
    if (!entry || entry.archivedAt !== null || Object.prototype.hasOwnProperty.call(store.deletedBaseIds, id)) {
      fail(`Destination knowledge base ${id} is unavailable, archived, or deleted.`);
    }
    entries.set(id, entry);
    guards.push(baseGuard(entry));
  }
  return { entries, guards };
}

function summarize(
  facts: readonly NoteOrganizerFileFact[],
  directives: readonly NormalizedDirective[],
  operations: readonly NoteOrganizerPlanOperation[],
  diffs: readonly NoteOrganizerDiff[],
): NoteOrganizerSummary {
  return {
    selectedNoteCount: new Set(facts.map((fact) => fact.path)).size,
    requestedBaseCount: new Set(facts.map((fact) => fact.baseId)).size,
    directiveCount: directives.length,
    changedBaseCount: operations.length,
    changedNoteBaseCount: diffs.length,
    noOpDirectiveCount: directives.length - diffs.length,
    primaryChanges: diffs.filter((diff) => diff.primaryChange !== null).length,
    collectionAdds: diffs.reduce((count, diff) => count + diff.collectionAdds.length, 0),
    collectionRemoves: diffs.reduce((count, diff) => count + diff.collectionRemoves.length, 0),
    portableSubjectsCreated: diffs.filter((diff) => diff.portableIdentity === "created").length,
    portableSubjectsReused: diffs.filter((diff) => diff.portableIdentity === "reused").length,
  };
}

/**
 * Organizer additions must remain loadable on the next launch. The loader's
 * authoritative organization limits are fail-closed, so crossing one during
 * Apply would turn an otherwise successful save into a read-only store.
 */
function assertOrganizerResultBounds(data: PluginData, baseName: string): void {
  let references = 0;
  let structures = 0;
  const add = (count: number, label: string, maximum = MAX_TRANSFER_LIST_ITEMS): void => {
    if (count > maximum) fail(`“${baseName}” would contain too many ${label}.`);
    if (references > MAX_TRANSFER_TOTAL_REFERENCES - count) {
      fail(`“${baseName}” would exceed the ${MAX_TRANSFER_TOTAL_REFERENCES.toLocaleString()}-reference safety limit.`);
    }
    references += count;
  };
  const ownCount = (value: Record<string, unknown>, label: string): number => {
    const count = Object.keys(value).length;
    if (count > MAX_TRANSFER_LIST_ITEMS) fail(`“${baseName}” would contain too many ${label}.`);
    return count;
  };
  const addLayout = (headings: readonly LayoutHeading[], label: string): void => {
    const stack: Array<LayoutHeading | LayoutSubheading> = [...headings];
    while (stack.length > 0) {
      const node = stack.pop();
      if (!node) continue;
      structures += 1;
      if (structures > MAX_TRANSFER_COLLECTIONS) {
        fail(`“${baseName}” would contain too many Collection or Library layout nodes.`);
      }
      add(node.subjects.length, `${label} subject references`);
      stack.push(...childSubheadings(node));
    }
  };

  addLayout(data.collections, "Collection");
  add(data.pinnedPaths.length, "pinned paths");
  add(data.nextStudyPaths.length, "Next-list paths");
  add(data.savedViews.length, "saved views");
  add(ownCount(data.curriculumVisual.parentByPath, "visual parent entries"), "visual parent entries");
  add(ownCount(data.curriculumVisual.orderByContainer, "visual order containers"), "visual order containers");
  for (const paths of Object.values(data.curriculumVisual.orderByContainer)) add(paths.length, "visual order paths");
  add(data.directIndexPaths.length, "direct Index paths");
  add(data.indexFolderSources.length, "linked Index folders");
  add(data.manualIndexPaths.length, "legacy Index paths");
  add(data.excludedIndexPaths.length, "hidden Index paths");
  add(ownCount(data.indexGroupByPath, "Index group assignments"), "Index group assignments");
  add(ownCount(data.displayNameByPath, "display names"), "display names");
  add(ownCount(data.indexGroupAliases, "Index group aliases"), "Index group aliases");
  add(data.indexGroupOrder.length, "Index group order entries");
  add(data.collapsed.curriculumDomains.length, "collapsed curriculum domains");
  add(data.collapsed.curriculumNodes.length, "collapsed curriculum nodes");
  add(data.collapsed.queues.length, "collapsed queues");

  const portable = data.portableIndex;
  add(portable.groups.length, "portable groups", MAX_TRANSFER_COLLECTIONS);
  add(portable.subjects.length, "portable subjects");
  add(ownCount(portable.resolvedPathBySubjectId, "portable note bindings"), "portable note bindings");
  add((portable.relinkableSubjectIds ?? []).length, "relinkable portable identities");
  add(portable.libraries.length, "Libraries", MAX_LIBRARIES);
  add(ownCount(portable.libraryLayouts, "Library layouts"), "Library layouts", MAX_LIBRARIES);
  for (const [libraryId, layout] of Object.entries(portable.libraryLayouts)) {
    addLayout(layout, `Library ${libraryId}`);
  }
}

function assertOrganizerStoreLoadable(store: PluginStore): void {
  try {
    // The loader shares its reference and text envelopes across every base.
    // Reusing that boundary catches a safe-looking per-base addition that
    // would otherwise make the complete synced store read-only next launch.
    migrateStore(store, 1);
  } catch (error) {
    const detail = error instanceof Error ? error.message : "The store failed validation.";
    fail(`The organizer result would not be safely loadable: ${detail}`);
  }
}

function applyOperationsUnchecked(store: PluginStore, operations: readonly NoteOrganizerPlanOperation[]): void {
  const used = new Set<string>();
  for (const operation of operations) {
    if (used.has(operation.baseId)) fail(`Knowledge base ${operation.baseId} appears more than once in the organizer plan.`);
    used.add(operation.baseId);
    const index = store.bases.findIndex((entry) => entry.id === operation.baseId);
    const current = index >= 0 ? store.bases[index] : undefined;
    if (!current || current.archivedAt !== null || entryGuard(current) !== operation.before.entryGuard) {
      fail(`Knowledge base “${operation.baseName}” changed after the organizer preview was prepared.`);
    }
    if (operation.afterEntry.id !== operation.baseId
      || entryGuard(operation.afterEntry) !== operation.afterEntryGuard
      || semanticEntryFingerprint(operation.afterEntry) !== operation.afterEntry.semanticHash) {
      fail(`The exact organizer result for “${operation.baseName}” is invalid.`);
    }
    const undoStack = operation.afterEntry.data.undoStack;
    const snapshot = undoStack[undoStack.length - 1];
    if (!snapshot || snapshot.at !== operation.undoSnapshotAt
      || fingerprint(snapshot) !== operation.undoSnapshotFingerprint) {
      fail(`The required Undo snapshot for “${operation.baseName}” is missing.`);
    }
    store.bases[index] = cloneJsonValue(operation.afterEntry);
  }
}

/** Exact result guard for only the bases this plan changes. */
function resultBaseGuard(store: PluginStore, baseIds: readonly string[]): string {
  const ids = [...new Set(baseIds)].sort(codeUnitCompare);
  return fingerprint(ids.map((baseId) => {
    const entry = store.bases.find((candidate) => candidate.id === baseId);
    return entry ? { baseId, entryGuard: entryGuard(entry) } : { baseId, missing: true };
  }));
}

/**
 * Prepare the exact, immutable multi-base mutation. This function changes no
 * live store and has no access to the filesystem; callers must expand folders
 * into exact file facts before invoking it.
 */
export function createNoteOrganizerPlan(
  store: PluginStore,
  fileFactInputs: readonly NoteOrganizerFileFact[],
  directiveInputs: readonly NoteOrganizerDirective[],
  options: NoteOrganizerPlanOptions = {},
): Readonly<NoteOrganizerPlan> {
  const facts = normalizeFacts(fileFactInputs);
  const directives = normalizeDirectives(directiveInputs);
  verifyFactsMatchDirectives(facts, directives);
  const now = options.now ?? Date.now();
  if (!Number.isSafeInteger(now) || now <= 0) fail("The organizer plan timestamp is invalid.");
  const expectedExternalGeneration = options.expectedExternalGeneration ?? 0;
  if (!Number.isSafeInteger(expectedExternalGeneration) || expectedExternalGeneration < 0) {
    fail("The organizer external-change generation is invalid.");
  }
  const { entries, guards } = validateStoreDestinations(store, facts);
  const noteCount = new Set(facts.map((fact) => fact.path)).size;
  const baseCount = guards.length;
  const defaultLabel = `Organize ${noteCount} ${noteCount === 1 ? "note" : "notes"} across ${baseCount} knowledge ${baseCount === 1 ? "base" : "bases"}`;
  const label = safeText(
    options.label ?? defaultLabel,
    "Organizer Undo label",
    MAX_NOTE_ORGANIZER_LABEL_LENGTH,
  );
  const expectedStoreGuard = noteOrganizerStoreGuard(store);
  const expectedFileFactsGuard = fingerprint(facts);
  const seed = fingerprint({ expectedStoreGuard, expectedFileFactsGuard, baseGuards: guards, directives, now, label });
  const operations: NoteOrganizerPlanOperation[] = [];
  const reviews: NoteOrganizerReview[] = [];
  const diffs: NoteOrganizerDiff[] = [];
  const factsByBaseId = new Map<string, NoteOrganizerFileFact[]>();
  const directivesByBaseId = new Map<string, NormalizedDirective[]>();
  for (const fact of facts) {
    const values = factsByBaseId.get(fact.baseId) ?? [];
    values.push(fact);
    factsByBaseId.set(fact.baseId, values);
  }
  for (const directive of directives) {
    const values = directivesByBaseId.get(directive.baseId) ?? [];
    values.push(directive);
    directivesByBaseId.set(directive.baseId, values);
  }

  for (const guard of guards) {
    const sourceEntry = entries.get(guard.baseId);
    if (!sourceEntry) return fail(`Destination knowledge base ${guard.baseId} is unavailable.`);
    const baseFacts = factsByBaseId.get(guard.baseId) ?? [];
    const baseDirectives = directivesByBaseId.get(guard.baseId) ?? [];
    const working = cloneJsonValue(sourceEntry);
    const context = createBaseContext(working, baseFacts, seed);
    for (const directive of baseDirectives) {
      const fact = context.factByPath.get(directive.path);
      if (!fact) return fail(`The selected-file fact for “${directive.path}” is missing.`);
      validateDirective(working, fact, directive, context);
    }
    const baseDiffs: NoteOrganizerDiff[] = [];
    const baseReviews: NoteOrganizerReview[] = [];
    for (const directive of baseDirectives) {
      const fact = context.factByPath.get(directive.path);
      if (!fact) return fail(`The selected-file fact for “${directive.path}” is missing.`);
      const before = membershipState(context, fact);
      const tracker: MutationTracker = { changed: false, portableIdentity: "not-needed" };
      applyPrimary(context, fact, directive.primary, tracker);
      applyCollections(context, fact.path, directive.collections, tracker);
      const after = membershipState(context, fact);
      baseReviews.push({
        baseId: guard.baseId,
        baseName: guard.baseName,
        path: fact.path,
        title: fact.title,
        before,
        after,
        changed: tracker.changed,
      });
      if (!tracker.changed) continue;
      const collectionDiff = diffMemberships(before.collections, after.collections);
      const primaryChanged = canonicalJsonString(before.primary) !== canonicalJsonString(after.primary);
      baseDiffs.push({
        baseId: guard.baseId,
        baseName: guard.baseName,
        path: fact.path,
        title: fact.title,
        before,
        after,
        primaryChange: primaryChanged
          ? `${describePrimary(before.primary)} → ${describePrimary(after.primary)}`
          : null,
        collectionAdds: collectionDiff.adds,
        collectionRemoves: collectionDiff.removes,
        portableIdentity: tracker.portableIdentity,
      });
    }
    flushCollectionMemberships(context);
    flushMembershipSets(context);
    if (baseDiffs.length > 0) assertOrganizerResultBounds(working.data, guard.baseName);
    if (pluginDataSemanticallyEqual(sourceEntry.data, working.data)) {
      for (const review of baseReviews) review.changed = false;
      reviews.push(...baseReviews);
      continue;
    }
    if (baseDiffs.length === 0) fail(`The organizer changed “${guard.baseName}” without a visible note/base diff.`);
    reviews.push(...baseReviews);
    if (sourceEntry.semanticRevision >= Number.MAX_SAFE_INTEGER) {
      fail(`Knowledge base “${guard.baseName}” has no safe semantic revision remaining.`);
    }
    if (!Number.isSafeInteger(sourceEntry.updatedAt) || sourceEntry.updatedAt >= Number.MAX_SAFE_INTEGER) {
      fail(`Knowledge base “${guard.baseName}” has no safe update timestamp remaining.`);
    }
    const undo = snapshotPersonal(sourceEntry.data, label, false, true);
    undo.at = now;
    const undoStack = limitSnapshotStack([...working.data.undoStack, undo]);
    if (!undoStack.includes(undo)) {
      fail(`“${guard.baseName}” is too large for required in-plugin Undo. Organize fewer notes or reduce that base's portable catalog.`);
    }
    working.data.undoStack = undoStack;
    working.data.redoStack = [];
    working.semanticRevision = sourceEntry.semanticRevision + 1;
    working.updatedAt = Math.max(now, sourceEntry.updatedAt + 1);
    working.semanticHash = semanticEntryFingerprint(working);
    working.semanticHead = deterministicSemanticHead(
      sourceEntry.semanticHead,
      working.semanticHash,
      `note-organizer:${seed}:${sourceEntry.id}`,
    );
    working.semanticLineage = boundedSemanticLineage(
      [sourceEntry.semanticHead, ...sourceEntry.semanticLineage],
      working.semanticHead,
    );
    const operation: NoteOrganizerPlanOperation = {
      baseId: guard.baseId,
      baseName: guard.baseName,
      before: guard,
      afterEntry: working,
      afterEntryGuard: entryGuard(working),
      undoSnapshotAt: now,
      undoSnapshotFingerprint: fingerprint(undo),
      diffs: baseDiffs,
    };
    operations.push(operation);
    diffs.push(...baseDiffs);
  }

  const afterStore = cloneJsonValue(store);
  applyOperationsUnchecked(afterStore, operations);
  if (afterStore.activeBaseId !== store.activeBaseId) fail("The organizer must not change the active knowledge base.");
  assertOrganizerStoreLoadable(afterStore);
  const withoutGuard: Omit<NoteOrganizerPlan, "planGuard"> = {
    kind: NOTE_ORGANIZER_KIND,
    version: NOTE_ORGANIZER_VERSION,
    id: `note-organizer-plan-${seed}`,
    createdAt: now,
    label,
    expectedStoreGuard,
    expectedAfterStoreGuard: resultBaseGuard(afterStore, operations.map((operation) => operation.baseId)),
    expectedExternalGeneration,
    expectedFileFactsGuard,
    fileFacts: facts,
    baseGuards: guards,
    operations,
    summary: summarize(facts, directives, operations, diffs),
    reviews,
    diffs,
    willNotChange: [
      "Markdown files, paths, names, content, frontmatter, links, and attachments will not change.",
      "Folder selection will not create a linked-folder membership rule or future automatic enrollment.",
      "Collections, pins, and Next-list membership stay intact unless an exact Collection directive changes that note.",
      "The active knowledge base will not change.",
    ],
  };
  const plan: NoteOrganizerPlan = { ...withoutGuard, planGuard: fingerprint(planPayload(withoutGuard)) };
  if (utf8Encoder.encode(JSON.stringify(plan)).byteLength > MAX_NOTE_ORGANIZER_PLAN_BYTES) {
    fail("The exact organizer preview exceeds the 32 MB safety limit. Organize fewer notes or bases at once.");
  }
  return deepFreeze(plan);
}

/**
 * Revalidate an opaque preview against current store, Sync generation, and
 * current file facts, then return the exact cloned candidate. The supplied
 * store is never mutated, including on success.
 */
export function applyNoteOrganizerPlan(
  store: PluginStore,
  plan: Readonly<NoteOrganizerPlan>,
  currentFileFactInputs: readonly NoteOrganizerFileFact[],
  currentExternalGeneration: number,
): PluginStore {
  if (!plan || typeof plan !== "object" || plan.kind !== NOTE_ORGANIZER_KIND || plan.version !== NOTE_ORGANIZER_VERSION) {
    return fail("The note organizer plan is unsupported. Prepare it again.");
  }
  if (!Array.isArray(plan.operations) || plan.operations.length > MAX_KNOWLEDGE_BASES
    || !Array.isArray(plan.baseGuards) || plan.baseGuards.length > MAX_KNOWLEDGE_BASES
    || !Array.isArray(plan.fileFacts) || plan.fileFacts.length > MAX_NOTE_ORGANIZER_DIRECTIVES
    || !Array.isArray(plan.reviews) || plan.reviews.length !== plan.fileFacts.length
    || !Array.isArray(plan.diffs) || plan.diffs.length > plan.fileFacts.length) {
    return fail("The note organizer plan exceeds its safety bounds. Prepare it again.");
  }
  const { planGuard, ...withoutGuard } = plan;
  if (fingerprint(planPayload(withoutGuard)) !== planGuard) {
    return fail("The note organizer plan changed after preview. Prepare it again.");
  }
  if (currentExternalGeneration !== plan.expectedExternalGeneration) {
    return fail("Synced plugin data changed after the organizer preview was prepared.");
  }
  if (noteOrganizerStoreGuard(store) !== plan.expectedStoreGuard) {
    return fail("The knowledge-base store identity changed after the organizer preview was prepared.");
  }
  const currentFacts = normalizeFacts(currentFileFactInputs);
  if (canonicalJsonString(currentFacts) !== canonicalJsonString(plan.fileFacts)
    || fingerprint(currentFacts) !== plan.expectedFileFactsGuard) {
    return fail("One or more selected Markdown notes changed, moved, disappeared, or were reclassified after preview.");
  }
  for (const guard of plan.baseGuards) {
    const entry = store.bases.find((candidate) => candidate.id === guard.baseId);
    if (!entry || Object.prototype.hasOwnProperty.call(store.deletedBaseIds, guard.baseId)
      || entryGuard(entry) !== guard.entryGuard
      || semanticEntryFingerprint(entry) !== guard.semanticFingerprint
      || entry.semanticRevision !== guard.semanticRevision
      || entry.semanticHead !== guard.semanticHead
      || entry.semanticHash !== guard.semanticHash) {
      return fail(`Knowledge base “${guard.baseName}” changed after the organizer preview was prepared.`);
    }
  }
  const callerActiveBaseId = store.activeBaseId;
  const candidate = cloneJsonValue(store);
  applyOperationsUnchecked(candidate, plan.operations);
  if (candidate.activeBaseId !== callerActiveBaseId) {
    return fail("The organizer result attempted to change the active knowledge base.");
  }
  if (resultBaseGuard(candidate, plan.operations.map((operation) => operation.baseId)) !== plan.expectedAfterStoreGuard) {
    return fail("The note organizer plan no longer produces its exact previewed result.");
  }
  assertOrganizerStoreLoadable(candidate);
  return candidate;
}
