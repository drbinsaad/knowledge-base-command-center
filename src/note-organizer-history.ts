import {
  boundedSemanticLineage,
  canonicalJsonString,
  cloneJsonValue,
  codeUnitCompare,
  createDeviceLocalPluginStateWithReport,
  deterministicSemanticHead,
  fingerprintText,
  limitSnapshotStack,
  MAX_KNOWLEDGE_BASES,
  pluginDataSemanticallyEqual,
  restoreSnapshot,
  semanticEntryFingerprint,
  snapshotPersonal,
  type KnowledgeBaseEntry,
  type PendingRequiredUndoBatchCommit,
  type PersonalSnapshot,
  type PluginStore,
} from "./model";

const NOTE_ORGANIZER_BATCH_HISTORY_KIND = "knowledge-base-command-center-note-organizer-batch-history" as const;
const NOTE_ORGANIZER_BATCH_HISTORY_VERSION = 1 as const;
const MAX_BATCH_HISTORY_ID_LENGTH = 300;
const MAX_BATCH_HISTORY_LABEL_LENGTH = 200;

export type NoteOrganizerBatchHistoryDirection = "undo" | "redo";
export type NoteOrganizerBatchHistoryState = "applied" | "undone";

export interface NoteOrganizerBatchSemanticGuard {
  baseId: string;
  createdAt: number;
  updatedAt: number;
  archivedAt: number | null;
  semanticRevision: number;
  semanticHead: string;
  semanticHash: string;
  semanticLineage: string[];
  semanticFingerprint: string;
  guard: string;
}

export interface NoteOrganizerBatchSnapshotProof {
  at: number;
  fingerprint: string;
}

export interface NoteOrganizerBatchHistoryBase {
  baseId: string;
  baseName: string;
  beforeSnapshot: PersonalSnapshot;
  afterSnapshot: PersonalSnapshot;
  beforeSnapshotFingerprint: string;
  afterSnapshotFingerprint: string;
  beforeSemanticHash: string;
  afterSemanticHash: string;
  expectedCurrent: NoteOrganizerBatchSemanticGuard;
  expectedUndoTop: NoteOrganizerBatchSnapshotProof;
}

export interface NoteOrganizerBatchHistoryToken {
  kind: typeof NOTE_ORGANIZER_BATCH_HISTORY_KIND;
  version: typeof NOTE_ORGANIZER_BATCH_HISTORY_VERSION;
  id: string;
  label: string;
  state: NoteOrganizerBatchHistoryState;
  transitionCount: number;
  vaultId: string;
  affectedBaseIds: string[];
  bases: NoteOrganizerBatchHistoryBase[];
  tokenGuard: string;
}

export interface CreateNoteOrganizerBatchHistoryTokenOptions {
  id: string;
  label: string;
  affectedBaseIds: readonly string[];
}

export interface NoteOrganizerBatchTransitionProjection {
  store: PluginStore;
  token: NoteOrganizerBatchHistoryToken;
  /** Pass these exact IDs to the store-wide required-Undo commit boundary. */
  requiredUndoBatchBaseIds: string[];
}

function fail(message: string): never {
  throw new Error(message);
}

function fingerprint(value: unknown): string {
  return fingerprintText(canonicalJsonString(value));
}

function cleanText(value: unknown, label: string, maximum: number): string {
  if (typeof value !== "string") fail(`${label} must be text.`);
  const clean = value.normalize("NFC").trim();
  if (!clean || clean.length > maximum || /[\p{Cc}\p{Cf}]/u.test(clean)) {
    fail(`${label} is invalid or too long.`);
  }
  return clean;
}

function snapshotProof(snapshot: PersonalSnapshot): NoteOrganizerBatchSnapshotProof {
  if (!Number.isSafeInteger(snapshot.at) || snapshot.at <= 0) {
    fail("The Note Organizer batch snapshot has an invalid timestamp.");
  }
  return { at: snapshot.at, fingerprint: fingerprint(snapshot) };
}

function snapshotsMatch(left: PersonalSnapshot, right: PersonalSnapshot): boolean {
  return canonicalJsonString(left) === canonicalJsonString(right);
}

function assertPortablePersonalSnapshot(snapshot: PersonalSnapshot, label: string): void {
  if (!snapshot.portableIndex) fail(`${label} must include the portable catalog.`);
  if (snapshot.settings !== undefined
    || snapshot.layoutSnapshots !== undefined
    || snapshot.activeTab !== undefined) {
    fail(`${label} contains state outside Note Organizer membership and portable identity.`);
  }
  const retained = limitSnapshotStack([cloneJsonValue(snapshot)]);
  if (retained.length !== 1 || fingerprint(retained[0]) !== fingerprint(snapshot)) {
    fail(`${label} is too large for exact in-plugin Undo.`);
  }
}

function semanticGuard(entry: KnowledgeBaseEntry): NoteOrganizerBatchSemanticGuard {
  const semanticFingerprint = semanticEntryFingerprint(entry);
  if (entry.semanticHash !== semanticFingerprint) {
    fail(`Knowledge base “${entry.data.settings.workspaceName}” has stale semantic authority.`);
  }
  if (!Number.isSafeInteger(entry.semanticRevision) || entry.semanticRevision < 0) {
    fail(`Knowledge base “${entry.data.settings.workspaceName}” has an invalid semantic revision.`);
  }
  const payload = {
    baseId: entry.id,
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
    archivedAt: entry.archivedAt,
    semanticRevision: entry.semanticRevision,
    semanticHead: entry.semanticHead,
    semanticHash: entry.semanticHash,
    semanticLineage: [...entry.semanticLineage],
    semanticFingerprint,
  };
  return { ...payload, guard: fingerprint(payload) };
}

function semanticGuardsMatch(left: NoteOrganizerBatchSemanticGuard, right: NoteOrganizerBatchSemanticGuard): boolean {
  return canonicalJsonString(left) === canonicalJsonString(right);
}

function fullEntryGuard(entry: KnowledgeBaseEntry): string {
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

function storeEnvelopeGuard(store: PluginStore): string {
  return fingerprint({
    kind: store.kind,
    version: store.version,
    vaultId: store.vaultId,
    deletedBaseIds: store.deletedBaseIds,
    baseIds: store.bases.map((entry) => entry.id),
  });
}

function tokenPayload(token: Omit<NoteOrganizerBatchHistoryToken, "tokenGuard">): unknown {
  return token;
}

function withTokenGuard(
  token: Omit<NoteOrganizerBatchHistoryToken, "tokenGuard">,
): NoteOrganizerBatchHistoryToken {
  return { ...token, tokenGuard: fingerprint(tokenPayload(token)) };
}

function expectedSnapshotFingerprint(
  base: NoteOrganizerBatchHistoryBase,
  state: NoteOrganizerBatchHistoryState,
): string {
  return state === "applied" ? base.beforeSnapshotFingerprint : base.afterSnapshotFingerprint;
}

function assertToken(token: Readonly<NoteOrganizerBatchHistoryToken>): void {
  if (!token || typeof token !== "object"
    || token.kind !== NOTE_ORGANIZER_BATCH_HISTORY_KIND
    || token.version !== NOTE_ORGANIZER_BATCH_HISTORY_VERSION) {
    fail("The Note Organizer batch history token is unsupported.");
  }
  if (token.state !== "applied" && token.state !== "undone") {
    fail("The Note Organizer batch history token has an invalid state.");
  }
  if (!Number.isSafeInteger(token.transitionCount) || token.transitionCount < 0
    || (token.transitionCount % 2 === 0) !== (token.state === "applied")) {
    fail("The Note Organizer batch history token has an invalid transition count.");
  }
  cleanText(token.id, "Note Organizer batch history ID", MAX_BATCH_HISTORY_ID_LENGTH);
  cleanText(token.label, "Note Organizer batch history label", MAX_BATCH_HISTORY_LABEL_LENGTH);
  if (!Array.isArray(token.bases) || token.bases.length < 1 || token.bases.length > MAX_KNOWLEDGE_BASES
    || !Array.isArray(token.affectedBaseIds) || token.affectedBaseIds.length !== token.bases.length) {
    fail("The Note Organizer batch history token has an invalid affected-base list.");
  }
  const sortedIds = token.bases.map((base) => base.baseId).sort(codeUnitCompare);
  if (new Set(sortedIds).size !== sortedIds.length
    || canonicalJsonString(sortedIds) !== canonicalJsonString(token.affectedBaseIds)) {
    fail("The Note Organizer batch history token must identify unique, sorted knowledge bases.");
  }
  const { tokenGuard, ...withoutGuard } = token;
  if (fingerprint(tokenPayload(withoutGuard)) !== tokenGuard) {
    fail("The Note Organizer batch history token changed after it was created.");
  }
  for (const base of token.bases) {
    assertPortablePersonalSnapshot(base.beforeSnapshot, `Before snapshot for “${base.baseName}”`);
    assertPortablePersonalSnapshot(base.afterSnapshot, `After snapshot for “${base.baseName}”`);
    if (fingerprint(base.beforeSnapshot) !== base.beforeSnapshotFingerprint
      || fingerprint(base.afterSnapshot) !== base.afterSnapshotFingerprint) {
      fail(`The Note Organizer batch snapshots for “${base.baseName}” changed after capture.`);
    }
    if (base.expectedCurrent.baseId !== base.baseId
      || base.expectedUndoTop.fingerprint !== expectedSnapshotFingerprint(base, token.state)
      || base.expectedUndoTop.at !== (token.state === "applied"
        ? base.beforeSnapshot.at
        : base.afterSnapshot.at)) {
      fail(`The Note Organizer batch guard for “${base.baseName}” is inconsistent.`);
    }
  }
}

function assertExpectedTopUndo(
  entry: KnowledgeBaseEntry,
  expected: NoteOrganizerBatchSnapshotProof,
  baseName: string,
): PersonalSnapshot {
  if (entry.data.redoStack.length !== 0) {
    fail(`Redo history for “${baseName}” changed after the Note Organizer batch transition.`);
  }
  const top = entry.data.undoStack[entry.data.undoStack.length - 1];
  if (!top || top.at !== expected.at || fingerprint(top) !== expected.fingerprint) {
    fail(`The newest Undo entry for “${baseName}” no longer matches the Note Organizer batch.`);
  }
  return top;
}

function pushExactInverse(
  currentUndo: readonly PersonalSnapshot[],
  expectedTop: NoteOrganizerBatchSnapshotProof,
  inverse: PersonalSnapshot,
  baseName: string,
): PersonalSnapshot[] {
  const top = currentUndo[currentUndo.length - 1];
  if (!top || top.at !== expectedTop.at || fingerprint(top) !== expectedTop.fingerprint) {
    fail(`The newest Undo entry for “${baseName}” no longer matches the Note Organizer batch.`);
  }
  const exactInverse = cloneJsonValue(inverse);
  const next = limitSnapshotStack([...currentUndo.slice(0, -1).map((snapshot) => cloneJsonValue(snapshot)), exactInverse]);
  const retained = next[next.length - 1];
  if (!retained || !snapshotsMatch(retained, exactInverse)) {
    fail(`The inverse snapshot for “${baseName}” is too large for exact in-plugin Undo.`);
  }
  return next;
}

function assertOnlyOrganizerStateChanged(
  before: KnowledgeBaseEntry,
  applied: KnowledgeBaseEntry,
  beforeSnapshot: PersonalSnapshot,
): void {
  const restored = cloneJsonValue(applied.data);
  restoreSnapshot(restored, beforeSnapshot);
  restored.undoStack = cloneJsonValue(before.data.undoStack);
  restored.redoStack = cloneJsonValue(before.data.redoStack);
  if (canonicalJsonString(restored) !== canonicalJsonString(before.data)) {
    fail(`The applied change for “${applied.data.settings.workspaceName}” includes state outside Note Organizer membership and portable identity.`);
  }
}

/**
 * Capture the exact in-session batch history token immediately after a
 * reviewed Note Organizer candidate has been applied. Empty exact operations
 * deliberately produce no token and therefore no misleading Undo affordance.
 */
export function createNoteOrganizerBatchHistoryToken(
  beforeStore: PluginStore,
  appliedStore: PluginStore,
  options: CreateNoteOrganizerBatchHistoryTokenOptions,
): NoteOrganizerBatchHistoryToken | null {
  const id = cleanText(options.id, "Note Organizer batch history ID", MAX_BATCH_HISTORY_ID_LENGTH);
  const label = cleanText(options.label, "Note Organizer batch history label", MAX_BATCH_HISTORY_LABEL_LENGTH);
  const affectedBaseIds = [...new Set(options.affectedBaseIds)].sort(codeUnitCompare);
  if (affectedBaseIds.length !== options.affectedBaseIds.length) {
    fail("The Note Organizer batch history cannot identify a knowledge base more than once.");
  }
  if (affectedBaseIds.length > MAX_KNOWLEDGE_BASES) {
    fail(`The Note Organizer batch history can identify at most ${MAX_KNOWLEDGE_BASES} knowledge bases.`);
  }
  if (storeEnvelopeGuard(beforeStore) !== storeEnvelopeGuard(appliedStore)) {
    fail("The knowledge-base store envelope changed while the Note Organizer batch was applied.");
  }

  const affected = new Set(affectedBaseIds);
  const beforeById = new Map(beforeStore.bases.map((entry) => [entry.id, entry]));
  const appliedById = new Map(appliedStore.bases.map((entry) => [entry.id, entry]));
  for (const before of beforeStore.bases) {
    const applied = appliedById.get(before.id);
    if (!applied) fail(`Knowledge base ${before.id} disappeared while the Note Organizer batch was applied.`);
    if (!affected.has(before.id) && fullEntryGuard(before) !== fullEntryGuard(applied)) {
      fail(`Unlisted knowledge base “${before.data.settings.workspaceName}” changed during the Note Organizer batch.`);
    }
  }
  if (affectedBaseIds.length === 0) return null;

  const bases: NoteOrganizerBatchHistoryBase[] = affectedBaseIds.map((baseId) => {
    const before = beforeById.get(baseId);
    const applied = appliedById.get(baseId);
    if (!before || !applied || before.archivedAt !== null || applied.archivedAt !== null) {
      return fail(`Affected knowledge base ${baseId} is unavailable or archived.`);
    }
    const beforeGuard = semanticGuard(before);
    const appliedGuard = semanticGuard(applied);
    if (pluginDataSemanticallyEqual(before.data, applied.data)
      || beforeGuard.semanticFingerprint === appliedGuard.semanticFingerprint) {
      return fail(`Affected knowledge base “${applied.data.settings.workspaceName}” has no semantic Note Organizer change.`);
    }
    if (before.semanticRevision >= Number.MAX_SAFE_INTEGER
      || applied.semanticRevision !== before.semanticRevision + 1
      || applied.semanticHead === before.semanticHead
      || applied.semanticLineage[0] !== before.semanticHead) {
      return fail(`The applied Note Organizer change for “${applied.data.settings.workspaceName}” has invalid causal authority.`);
    }
    if (applied.data.redoStack.length !== 0) {
      return fail(`The applied Note Organizer change for “${applied.data.settings.workspaceName}” did not clear Redo history.`);
    }
    const requiredUndo = applied.data.undoStack[applied.data.undoStack.length - 1];
    if (!requiredUndo) {
      return fail(`The applied Note Organizer change for “${applied.data.settings.workspaceName}” has no required Undo snapshot.`);
    }
    const expectedBefore = snapshotPersonal(before.data, label, false, true);
    expectedBefore.at = requiredUndo.at;
    if (!snapshotsMatch(requiredUndo, expectedBefore)) {
      return fail(`The newest Undo entry for “${applied.data.settings.workspaceName}” is not the exact pre-Apply Note Organizer snapshot.`);
    }
    const beforeSnapshot = cloneJsonValue(requiredUndo);
    const afterSnapshot = snapshotPersonal(applied.data, label, false, true);
    afterSnapshot.at = requiredUndo.at;
    assertPortablePersonalSnapshot(beforeSnapshot, `Before snapshot for “${applied.data.settings.workspaceName}”`);
    assertPortablePersonalSnapshot(afterSnapshot, `After snapshot for “${applied.data.settings.workspaceName}”`);
    assertOnlyOrganizerStateChanged(before, applied, beforeSnapshot);
    pushExactInverse(
      applied.data.undoStack,
      snapshotProof(beforeSnapshot),
      afterSnapshot,
      applied.data.settings.workspaceName,
    );
    return {
      baseId,
      baseName: applied.data.settings.workspaceName,
      beforeSnapshot,
      afterSnapshot,
      beforeSnapshotFingerprint: fingerprint(beforeSnapshot),
      afterSnapshotFingerprint: fingerprint(afterSnapshot),
      beforeSemanticHash: beforeGuard.semanticFingerprint,
      afterSemanticHash: appliedGuard.semanticFingerprint,
      expectedCurrent: appliedGuard,
      expectedUndoTop: snapshotProof(beforeSnapshot),
    };
  });

  return withTokenGuard({
    kind: NOTE_ORGANIZER_BATCH_HISTORY_KIND,
    version: NOTE_ORGANIZER_BATCH_HISTORY_VERSION,
    id,
    label,
    state: "applied",
    transitionCount: 0,
    vaultId: appliedStore.vaultId,
    affectedBaseIds,
    bases,
  });
}

function requiredUndoBatchMarker(
  store: PluginStore,
  bases: readonly NoteOrganizerBatchHistoryBase[],
): PendingRequiredUndoBatchCommit {
  return {
    entries: bases.map((base) => {
      const entry = store.bases.find((candidate) => candidate.id === base.baseId);
      if (!entry) return fail(`Affected knowledge base ${base.baseId} is unavailable after projection.`);
      const top = entry.data.undoStack[entry.data.undoStack.length - 1];
      if (!top) return fail(`The projected inverse snapshot for “${base.baseName}” is missing.`);
      return {
        baseId: base.baseId,
        baseExistedBefore: true,
        candidateSemanticRevision: entry.semanticRevision,
        candidateSemanticHead: entry.semanticHead,
        candidateSemanticHash: entry.semanticHash,
        undoSnapshotAt: top.at,
        undoSnapshotFingerprint: fingerprint(top),
      };
    }),
  };
}

/**
 * Project one all-or-nothing in-session Undo/Redo transition. The source store
 * and token are never mutated. Each changed base receives an ordinary newest
 * Undo snapshot as durable fallback; Redo is owned by the in-memory token.
 */
export function projectNoteOrganizerBatchTransition(
  store: PluginStore,
  token: Readonly<NoteOrganizerBatchHistoryToken>,
  direction: NoteOrganizerBatchHistoryDirection,
): NoteOrganizerBatchTransitionProjection {
  assertToken(token);
  if (store.vaultId !== token.vaultId) {
    return fail("The Note Organizer batch history belongs to another vault.");
  }
  if (direction === "undo" ? token.state !== "applied" : token.state !== "undone") {
    return fail(`The Note Organizer batch cannot ${direction} from its current state.`);
  }

  for (const base of token.bases) {
    const current = store.bases.find((entry) => entry.id === base.baseId);
    if (!current || current.archivedAt !== null) {
      return fail(`Affected knowledge base “${base.baseName}” is unavailable or archived.`);
    }
    if (!semanticGuardsMatch(semanticGuard(current), base.expectedCurrent)) {
      return fail(`Knowledge base “${base.baseName}” changed after the Note Organizer batch transition.`);
    }
    assertExpectedTopUndo(current, base.expectedUndoTop, base.baseName);
  }

  const candidate = cloneJsonValue(store);
  const nextTransitionCount = token.transitionCount + 1;
  const nextState: NoteOrganizerBatchHistoryState = direction === "undo" ? "undone" : "applied";
  const nextBases = token.bases.map((base): NoteOrganizerBatchHistoryBase => {
    const current = candidate.bases.find((entry) => entry.id === base.baseId);
    if (!current) return fail(`Affected knowledge base “${base.baseName}” is unavailable after cloning.`);
    if (current.semanticRevision >= Number.MAX_SAFE_INTEGER
      || current.updatedAt >= Number.MAX_SAFE_INTEGER
      || !Number.isSafeInteger(current.updatedAt)) {
      return fail(`Knowledge base “${base.baseName}” has no safe semantic revision or timestamp remaining.`);
    }
    const target = direction === "undo" ? base.beforeSnapshot : base.afterSnapshot;
    const inverse = direction === "undo" ? base.afterSnapshot : base.beforeSnapshot;
    const targetSemanticHash = direction === "undo" ? base.beforeSemanticHash : base.afterSemanticHash;
    const parentHead = current.semanticHead;
    const priorUndo = cloneJsonValue(current.data.undoStack);
    restoreSnapshot(current.data, target);
    current.data.undoStack = pushExactInverse(priorUndo, base.expectedUndoTop, inverse, base.baseName);
    current.data.redoStack = [];
    current.semanticRevision += 1;
    current.updatedAt += 1;
    current.semanticHash = semanticEntryFingerprint(current);
    if (current.semanticHash !== targetSemanticHash) {
      return fail(`The ${direction} projection for “${base.baseName}” no longer matches its exact captured organization state.`);
    }
    current.semanticHead = deterministicSemanticHead(
      parentHead,
      current.semanticHash,
      `note-organizer-batch-history:${token.id}:${nextTransitionCount}:${direction}:${base.baseId}`,
    );
    current.semanticLineage = boundedSemanticLineage(
      [parentHead, ...current.semanticLineage],
      current.semanticHead,
    );
    const expectedUndoTop = snapshotProof(inverse);
    assertExpectedTopUndo(current, expectedUndoTop, base.baseName);
    return {
      ...cloneJsonValue(base),
      expectedCurrent: semanticGuard(current),
      expectedUndoTop,
    };
  });

  if (candidate.activeBaseId !== store.activeBaseId) {
    return fail("The Note Organizer batch history attempted to change the active knowledge base.");
  }
  const marker = requiredUndoBatchMarker(candidate, nextBases);
  try {
    createDeviceLocalPluginStateWithReport(candidate, undefined, undefined, marker);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/could not be bounded safely|too large/iu.test(message)) {
      return fail("The Note Organizer batch transition cannot keep every exact inverse Undo snapshot within the 4 MiB device-local limit.");
    }
    throw error;
  }
  const nextToken = withTokenGuard({
    kind: NOTE_ORGANIZER_BATCH_HISTORY_KIND,
    version: NOTE_ORGANIZER_BATCH_HISTORY_VERSION,
    id: token.id,
    label: token.label,
    state: nextState,
    transitionCount: nextTransitionCount,
    vaultId: token.vaultId,
    affectedBaseIds: [...token.affectedBaseIds],
    bases: nextBases,
  });
  return {
    store: candidate,
    token: nextToken,
    requiredUndoBatchBaseIds: [...token.affectedBaseIds],
  };
}
