import {
  canonicalInterimEnvelopeString,
  MAX_DELETED_KNOWLEDGE_BASE_IDS,
  MAX_KNOWLEDGE_BASES,
  pristineProvisionalInterimEnvelopeStoreFingerprint,
  pristineProvisionalMigratedStoreFingerprint,
  provisionalInterimEnvelopeVaultFingerprint,
  provisionalMigratedVaultFingerprint,
  STORE_KIND,
  STORE_VERSION,
  type KnowledgeBaseEntry,
  type PluginStore,
} from "./model";

export interface StoreMergeResult {
  store: PluginStore;
  /** True when base payloads—not only this device's active selection—differ from the incoming file. */
  incomingNeedsWriteback: boolean;
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
  // updatedAt normally resolves the winner. A deterministic payload comparison
  // makes same-millisecond edits converge instead of each device choosing the
  // other device's copy forever.
  return canonicalStringify([entry.createdAt, entry.archivedAt, entry.data]);
}

function winningEntry(local: KnowledgeBaseEntry, incoming: KnowledgeBaseEntry): KnowledgeBaseEntry {
  if (local.updatedAt !== incoming.updatedAt) return local.updatedAt > incoming.updatedAt ? local : incoming;
  return entryFingerprint(local) >= entryFingerprint(incoming) ? local : incoming;
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
      entry.data.settings.workspaceName = candidate;
      changed = true;
    }
    used.add(normalizedName(candidate));
  }
  return changed;
}

/**
 * Merge two already-migrated current-version envelopes by stable base ID. Separate bases
 * are independent conflict units; the newer `updatedAt` wins only within the
 * same base. Archive timestamps act as tombstones because archived entries are
 * retained rather than deleted.
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
      if (!localEnvelopeFingerprint
        || localEnvelopeFingerprint !== incomingEnvelopeFingerprint
        || !exactEnvelopeMatch) {
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
  for (const entry of local.bases) if (!Object.prototype.hasOwnProperty.call(deletedBaseIds, entry.id)) byId.set(entry.id, entry);
  for (const entry of incoming.bases) {
    if (Object.prototype.hasOwnProperty.call(deletedBaseIds, entry.id)) continue;
    const current = byId.get(entry.id);
    byId.set(entry.id, current ? winningEntry(current, entry) : entry);
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
      bases: sortedEntries(value.bases).map((entry) => entry),
      deletedBaseIds: value.deletedBaseIds,
    },
  );
  return {
    store,
    incomingNeedsWriteback: namesChanged
      || vaultId !== incoming.vaultId
      || normalizeForComparison(store) !== normalizeForComparison(incoming),
  };
}
