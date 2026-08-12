import {
  applyPluginViewState,
  boundedSemanticLineage,
  canonicalInterimEnvelopeString,
  capturePluginViewState,
  deterministicSemanticHead,
  MAX_DELETED_KNOWLEDGE_BASE_IDS,
  MAX_KNOWLEDGE_BASES,
  pristineProvisionalInterimEnvelopeStoreFingerprint,
  pristineProvisionalMigratedStoreFingerprint,
  provisionalInterimEnvelopeVaultFingerprint,
  provisionalMigratedVaultFingerprint,
  resetPluginViewState,
  semanticEntryFingerprint,
  semanticPluginDataProjection,
  STORE_KIND,
  STORE_VERSION,
  type KnowledgeBaseEntry,
  type PluginStore,
} from "./model";

export interface StoreMergeResult {
  store: PluginStore;
  /** True when semantic base payloads—not this device's view state—differ from the incoming file. */
  incomingNeedsWriteback: boolean;
  /** Unrelated semantic divergence that must be rescued before adoption. */
  semanticConflicts: SemanticStoreConflict[];
}

export interface SemanticStoreConflict {
  baseId: string;
  revision: number;
  winner: "local" | "incoming";
  localFingerprint: string;
  incomingFingerprint: string;
}

function normalizedName(name: string): string {
  return name.trim().normalize("NFC").toLowerCase();
}

function clippedSyncedName(name: string, suffix: string): string {
  const available = Math.max(1, 100 - suffix.length);
  const prefix = name.trim().slice(0, available).trim() || "Knowledge base";
  return `${prefix}${suffix}`;
}

function nameWithoutGeneratedSyncSuffix(name: string): string {
  return name.trim().replace(/(?:\s+\(synced \d+\))+$/i, "").trim() || "Knowledge base";
}

function canonicalJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => canonicalJsonValue(item) ?? null);
  if (!value || typeof value !== "object") return value;
  const output: Record<string, unknown> = {};
  for (const key of Object.keys(value).sort()) {
    const normalized = canonicalJsonValue((value as Record<string, unknown>)[key]);
    if (normalized !== undefined) output[key] = normalized;
  }
  return output;
}

function canonicalStringify(value: unknown): string {
  return JSON.stringify(canonicalJsonValue(value));
}

function entryFingerprint(entry: KnowledgeBaseEntry): string {
  return canonicalStringify([
    entry.createdAt,
    entry.archivedAt,
    semanticPluginDataProjection(entry.data),
  ]);
}

function deterministicWinner(
  local: KnowledgeBaseEntry,
  incoming: KnowledgeBaseEntry,
  localFingerprint: string,
  incomingFingerprint: string,
): "local" | "incoming" {
  if (local.semanticRevision !== incoming.semanticRevision) {
    return local.semanticRevision > incoming.semanticRevision ? "local" : "incoming";
  }
  if (localFingerprint !== incomingFingerprint) return localFingerprint >= incomingFingerprint ? "local" : "incoming";
  return local.semanticHead >= incoming.semanticHead ? "local" : "incoming";
}

function mergeEquivalentCausality(local: KnowledgeBaseEntry, incoming: KnowledgeBaseEntry): {
  semanticHead: string;
  semanticHash: string;
  semanticLineage: string[];
  semanticRevision: number;
} {
  const headWinner = local.semanticHead >= incoming.semanticHead ? local : incoming;
  const other = headWinner === local ? incoming : local;
  return {
    semanticHead: headWinner.semanticHead,
    semanticHash: headWinner.semanticHash,
    semanticLineage: boundedSemanticLineage([
      other.semanticHead,
      ...headWinner.semanticLineage,
      ...other.semanticLineage,
    ], headWinner.semanticHead),
    semanticRevision: Math.max(local.semanticRevision, incoming.semanticRevision),
  };
}

function mergeMatchingEntry(
  local: KnowledgeBaseEntry,
  incoming: KnowledgeBaseEntry,
): { entry: KnowledgeBaseEntry; conflict: SemanticStoreConflict | null } {
  const localFingerprint = entryFingerprint(local);
  const incomingFingerprint = entryFingerprint(incoming);
  const semanticsEqual = localFingerprint === incomingFingerprint;
  // A lineage is causal proof only while each endpoint's stored semantic hash
  // still describes its payload. This makes malformed, stale, and hand-edited
  // envelopes fail closed into conflict rescue instead of claiming ancestry.
  const localTrusted = local.semanticHash === semanticEntryFingerprint(local);
  const incomingTrusted = incoming.semanticHash === semanticEntryFingerprint(incoming);
  const localDescendsFromIncoming = localTrusted && incomingTrusted
    && local.semanticLineage.includes(incoming.semanticHead);
  const incomingDescendsFromLocal = localTrusted && incomingTrusted
    && incoming.semanticLineage.includes(local.semanticHead);
  const causallyOrdered = localDescendsFromIncoming !== incomingDescendsFromLocal;
  let winner: "local" | "incoming";
  if (semanticsEqual) {
    // The captured file is already authoritative for equal semantics. Local
    // device view state is overlaid below and never forces a writeback.
    winner = "incoming";
  } else if (causallyOrdered) {
    winner = localDescendsFromIncoming ? "local" : "incoming";
  } else {
    // Revisions guide only deterministic adoption after a conflict is known;
    // they never prove that one independently edited device descends from the
    // other.
    winner = deterministicWinner(local, incoming, localFingerprint, incomingFingerprint);
  }

  const merged = structuredClone(winner === "local" ? local : incoming);
  if (semanticsEqual) {
    // Legacy v11-v13 builds advanced updatedAt for UI-only saves. Preserve the
    // greater timestamp deterministically while the v14 projection discards
    // those harmless view differences; choosing the directional incoming copy
    // would otherwise make this semantic metadata non-commutative.
    merged.updatedAt = Math.max(local.updatedAt, incoming.updatedAt);
    if (localTrusted && incomingTrusted) {
      const causality = mergeEquivalentCausality(local, incoming);
      merged.semanticHead = causality.semanticHead;
      merged.semanticHash = causality.semanticHash;
      merged.semanticLineage = causality.semanticLineage;
      merged.semanticRevision = causality.semanticRevision;
    } else {
      // Equal payloads need no rescue, but untrusted ancestry is discarded so
      // it cannot influence a later divergent merge.
      merged.semanticHash = semanticEntryFingerprint(merged);
      merged.semanticHead = merged.semanticHash;
      merged.semanticLineage = [];
      merged.semanticRevision = Math.max(local.semanticRevision, incoming.semanticRevision);
    }
  } else if (causallyOrdered) {
    const ancestor = winner === "local" ? incoming : local;
    merged.semanticLineage = boundedSemanticLineage([
      ancestor.semanticHead,
      ...merged.semanticLineage,
      ...ancestor.semanticLineage,
    ], merged.semanticHead);
  }
  // Routes and live disclosure state stay local. A remote semantic replacement
  // invalidates this device's Undo/Redo snapshots; equal semantics do not.
  applyPluginViewState(
    merged.data,
    capturePluginViewState(local.data),
    winner === "local" || semanticsEqual,
  );
  const conflict = !semanticsEqual && !causallyOrdered
    ? {
      baseId: local.id,
      revision: Math.max(local.semanticRevision, incoming.semanticRevision),
      winner,
      localFingerprint,
      incomingFingerprint,
    }
    : null;
  return { entry: merged, conflict };
}

function semanticEntryForComparison(entry: KnowledgeBaseEntry): unknown {
  return {
    id: entry.id,
    createdAt: entry.createdAt,
    semanticRevision: entry.semanticRevision,
    semanticHead: entry.semanticHead,
    semanticHash: entry.semanticHash,
    semanticLineage: entry.semanticLineage,
    archivedAt: entry.archivedAt,
    data: semanticPluginDataProjection(entry.data),
  };
}

function sortedEntries(entries: Iterable<KnowledgeBaseEntry>): KnowledgeBaseEntry[] {
  return [...entries].sort((left, right) => left.createdAt - right.createdAt || left.id.localeCompare(right.id));
}

function makeAvailableNamesUnique(entries: KnowledgeBaseEntry[]): boolean {
  const used = new Set<string>();
  let changed = false;
  for (const entry of entries) {
    if (entry.archivedAt !== null) continue;
    const original = entry.data.settings.workspaceName.trim() || "Knowledge base";
    const suffixRoot = nameWithoutGeneratedSyncSuffix(original);
    let candidate = original;
    let suffixNumber = 2;
    while (used.has(normalizedName(candidate))) {
      candidate = clippedSyncedName(suffixRoot, ` (synced ${suffixNumber})`);
      suffixNumber += 1;
    }
    if (candidate !== entry.data.settings.workspaceName) {
      if (!Number.isSafeInteger(entry.semanticRevision) || entry.semanticRevision < 0
        || entry.semanticRevision >= Number.MAX_SAFE_INTEGER) {
        throw new Error("A synced knowledge-base semantic revision cannot be advanced safely during name repair.");
      }
      const parentHead = entry.semanticHead;
      entry.data.settings.workspaceName = candidate;
      entry.semanticRevision += 1;
      entry.semanticHash = semanticEntryFingerprint(entry);
      entry.semanticHead = deterministicSemanticHead(parentHead, entry.semanticHash, "unique-synced-name");
      entry.semanticLineage = boundedSemanticLineage([parentHead, ...entry.semanticLineage], entry.semanticHead);
      entry.updatedAt += 1;
      changed = true;
    }
    used.add(normalizedName(candidate));
  }
  return changed;
}

/**
 * Merge two already-migrated current-version envelopes by stable base ID. Separate bases
 * are independent conflict units. Bounded causal ancestry decides descendants;
 * scalar revisions guide only deterministic adoption after unrelated edits
 * have been classified as a conflict and rescued.
 *
 * `preferredActiveId` is device-local UI state. It is preserved whenever that
 * base still exists and is available, so Sync cannot switch an open modal from
 * ENT to Research merely because another device viewed a different base.
 */
export function mergeKnowledgeBaseStores(
  local: PluginStore,
  incoming: PluginStore,
  preferredActiveId = local.activeBaseId,
): StoreMergeResult {
  let vaultId = local.vaultId;
  if (local.vaultId !== incoming.vaultId) {
    const localLegacyOrigin = provisionalMigratedVaultFingerprint(local.vaultId);
    const incomingLegacyOrigin = provisionalMigratedVaultFingerprint(incoming.vaultId);
    const localLegacyFingerprint = pristineProvisionalMigratedStoreFingerprint(local);
    const incomingLegacyFingerprint = pristineProvisionalMigratedStoreFingerprint(incoming);
    if (localLegacyFingerprint && localLegacyFingerprint === incomingLegacyFingerprint) {
      // Concurrent first-upgrade copies of the same pristine flat v1-v10 store
      // each receive a random identity. Keep this compatibility path separate
      // from the complete-envelope migration below.
      const fullIds = [local.vaultId, incoming.vaultId]
        .filter((id) => provisionalMigratedVaultFingerprint(id) !== null)
        .sort((left, right) => left.localeCompare(right));
      vaultId = fullIds[0] ?? [local.vaultId, incoming.vaultId].sort((left, right) => left.localeCompare(right))[0];
    } else if (localLegacyOrigin
      && localLegacyOrigin === incomingLegacyOrigin
      && Boolean(localLegacyFingerprint) !== Boolean(incomingLegacyFingerprint)) {
      // Both copies came from the same flat legacy payload, but exactly one was
      // edited before first-upgrade Sync converged. The pristine copy has no
      // unique work to preserve, so converge on the edited copy's identity.
      // If both copies were edited, neither side is privileged and the normal
      // cross-vault rejection below remains in force.
      vaultId = localLegacyFingerprint ? incoming.vaultId : local.vaultId;
    } else {
      const localEnvelopeFingerprint = pristineProvisionalInterimEnvelopeStoreFingerprint(local);
      const incomingEnvelopeFingerprint = pristineProvisionalInterimEnvelopeStoreFingerprint(incoming);
      const exactEnvelopeMatch = canonicalInterimEnvelopeString(local) === canonicalInterimEnvelopeString(incoming);
      // Devices that migrated before base IDs were ordered locale-independently
      // embed a fingerprint of the old ordering, so two pristine copies of one
      // envelope can carry different fingerprints. Two pristine provisional
      // identities over a byte-equal canonical envelope still prove one origin.
      if (!localEnvelopeFingerprint || !incomingEnvelopeFingerprint || !exactEnvelopeMatch) {
        throw new Error("Synced plugin data belongs to a different Obsidian vault.");
      }
      // Two devices can load the same already-multi-base v11 envelope before
      // either writes its new vaultId. Converge only while the whole canonical
      // envelope is unchanged and byte-equivalent, then write back one random
      // identity symmetrically.
      const fullIds = [local.vaultId, incoming.vaultId]
        .filter((id) => provisionalInterimEnvelopeVaultFingerprint(id) !== null)
        .sort((left, right) => left.localeCompare(right));
      vaultId = fullIds[0] ?? [local.vaultId, incoming.vaultId].sort((left, right) => left.localeCompare(right))[0];
    }
  }
  const deletedTimestamps = new Map(Object.entries(local.deletedBaseIds));
  for (const [id, deletedAt] of Object.entries(incoming.deletedBaseIds)) {
    deletedTimestamps.set(id, Math.max(deletedTimestamps.get(id) ?? 0, deletedAt));
  }
  const deletedBaseIds = Object.fromEntries([...deletedTimestamps.entries()].sort(([left], [right]) => left.localeCompare(right)));
  if (Object.keys(deletedBaseIds).length > MAX_DELETED_KNOWLEDGE_BASE_IDS) {
    throw new Error(`Synced knowledge-base changes contain more than ${MAX_DELETED_KNOWLEDGE_BASE_IDS.toLocaleString()} permanent-deletion tombstones. No tombstone was discarded.`);
  }
  const byId = new Map<string, KnowledgeBaseEntry>();
  const semanticConflicts: SemanticStoreConflict[] = [];
  // A tombstone still deletes deterministically, but a copy of the base that
  // was edited AFTER the deletion carries work the deleting device never saw.
  // Classify that copy as a losing conflict so the merge worker rescues its
  // whole envelope before the deletion is adopted; a plain drop would be the
  // only merge outcome with no durable copy of the losing payload.
  const tombstonedEditConflict = (
    entry: KnowledgeBaseEntry,
    winner: "local" | "incoming",
  ): SemanticStoreConflict | null => {
    const deletedAt = deletedTimestamps.get(entry.id);
    if (deletedAt === undefined || entry.updatedAt <= deletedAt) return null;
    return {
      baseId: entry.id,
      revision: entry.semanticRevision,
      winner,
      localFingerprint: winner === "incoming" ? entryFingerprint(entry) : "deleted",
      incomingFingerprint: winner === "incoming" ? "deleted" : entryFingerprint(entry),
    };
  };
  for (const entry of local.bases) {
    if (!Object.prototype.hasOwnProperty.call(deletedBaseIds, entry.id)) {
      byId.set(entry.id, entry);
      continue;
    }
    const conflict = tombstonedEditConflict(entry, "incoming");
    if (conflict) semanticConflicts.push(conflict);
  }
  for (const entry of incoming.bases) {
    if (Object.prototype.hasOwnProperty.call(deletedBaseIds, entry.id)) {
      const conflict = tombstonedEditConflict(entry, "local");
      if (conflict) semanticConflicts.push(conflict);
      continue;
    }
    const current = byId.get(entry.id);
    if (current) {
      const merged = mergeMatchingEntry(current, entry);
      byId.set(entry.id, merged.entry);
      if (merged.conflict) semanticConflicts.push(merged.conflict);
    } else {
      const firstOnDevice = structuredClone(entry);
      resetPluginViewState(firstOnDevice.data);
      byId.set(entry.id, firstOnDevice);
    }
  }
  if (byId.size > MAX_KNOWLEDGE_BASES) {
    throw new Error(`Synced knowledge-base changes contain ${byId.size} bases, above the safe limit of ${MAX_KNOWLEDGE_BASES}. No base was discarded.`);
  }

  const bases = sortedEntries(byId.values()).map((entry) => structuredClone(entry));
  const namesChanged = makeAvailableNamesUnique(bases);
  const isAvailable = (id: string): boolean => bases.some((entry) => entry.id === id && entry.archivedAt === null);
  const activeBaseId = isAvailable(preferredActiveId)
    ? preferredActiveId
    : isAvailable(incoming.activeBaseId)
      ? incoming.activeBaseId
      : bases.find((entry) => entry.archivedAt === null)?.id ?? "";
  if (!activeBaseId) throw new Error("Synced knowledge-base changes left no available base.");

  const store: PluginStore = {
    kind: STORE_KIND,
    version: STORE_VERSION,
    vaultId,
    activeBaseId,
    bases,
    deletedBaseIds,
  };
  const normalizeForComparison = (value: PluginStore): string => canonicalStringify(
    {
      bases: sortedEntries(value.bases).map((entry) => semanticEntryForComparison(entry)),
      deletedBaseIds: value.deletedBaseIds,
    },
  );
  return {
    store,
    semanticConflicts,
    incomingNeedsWriteback: namesChanged
      || vaultId !== incoming.vaultId
      || normalizeForComparison(store) !== normalizeForComparison(incoming),
  };
}
