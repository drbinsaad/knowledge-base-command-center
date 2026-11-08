/**
 * App-local crash journal for physical vault renames whose plugin-data path
 * rewrite has not yet committed. It is intentionally separate from the v4
 * view/Undo journal: an ordinary route save must never erase rename recovery,
 * and a rename record must never displace a protected required-Undo marker.
 *
 * Format v2 keeps the v1 storage address on purpose: a 0.26.1 reader that finds
 * the unsupported envelope enters its existing read-only recovery path instead
 * of ignoring outstanding repairs. Genuine v1 envelopes read as `bound`.
 */

export const VAULT_RENAME_JOURNAL_VERSION = 2;
export const LEGACY_VAULT_RENAME_JOURNAL_VERSION = 1;
export const MAX_PENDING_VAULT_RENAMES = 10_000;
export const MAX_VAULT_RENAME_JOURNAL_BYTES = 4 * 1024 * 1024;
/** Headroom kept free so a small `blocked` marker always fits the envelope bound. */
const VAULT_RENAME_BLOCKED_RESERVE_BYTES = 1024;
const MAX_VAULT_PATH_LENGTH = 4_096;

export interface PendingVaultRename {
  oldPath: string;
  newPath: string;
  folderRename: boolean;
}

/**
 * `bound` repairs only the exact accepted vault identity. `bootstrap` holds
 * events captured while primary authority was missing; `expectedVaultId` is a
 * previously established identity when one is known.
 */
export type VaultRenameScope =
  | { kind: "bound"; vaultId: string }
  | { kind: "bootstrap"; bootstrapId: string; expectedVaultId: string | null };

export type VaultRenameBlockedReason = "overflow" | "ambiguous-path";

export interface VaultRenameJournal {
  version: typeof VAULT_RENAME_JOURNAL_VERSION;
  scope: VaultRenameScope;
  renames: PendingVaultRename[];
  blocked: VaultRenameBlockedReason | null;
}

function serializedUtf8Bytes(value: unknown): number {
  const serialized = JSON.stringify(value);
  if (serialized === undefined) throw new Error("Vault-rename journal is not serializable.");
  return new TextEncoder().encode(serialized).byteLength;
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const keys = Object.keys(value).sort();
  const required = [...expected].sort();
  return keys.length === required.length && keys.every((key, index) => key === required[index]);
}

function cleanVaultId(value: unknown): string {
  if (typeof value !== "string") throw new Error("Vault-rename journal has an invalid vault identity.");
  const id = value.trim();
  if (!id || id.length > 128 || !/^[a-z0-9][a-z0-9._:@+-]*$/iu.test(id)) {
    throw new Error("Vault-rename journal has an invalid vault identity.");
  }
  return id;
}

function cleanVaultPath(value: unknown, label: string): string {
  if (typeof value !== "string"
    || value.length === 0
    || value.length > MAX_VAULT_PATH_LENGTH
    || value.startsWith("/")
    || value.endsWith("/")
    || /[\p{Cc}\p{Cf}]/u.test(value)
    || value.split("/").some((segment) => segment === "" || segment === "." || segment === "..")) {
    throw new Error(`${label} is malformed.`);
  }
  return value;
}

function parseRenames(raw: unknown[]): PendingVaultRename[] {
  return raw.map((entryRaw, index): PendingVaultRename => {
    if (!entryRaw || typeof entryRaw !== "object" || Array.isArray(entryRaw)) {
      throw new Error(`Vault-rename journal entry ${index + 1} is malformed.`);
    }
    const entry = entryRaw as Record<string, unknown>;
    if (!hasExactKeys(entry, ["oldPath", "newPath", "folderRename"])) {
      throw new Error(`Vault-rename journal entry ${index + 1} is malformed.`);
    }
    const oldPath = cleanVaultPath(entry.oldPath, `Vault-rename journal entry ${index + 1} source path`);
    const newPath = cleanVaultPath(entry.newPath, `Vault-rename journal entry ${index + 1} destination path`);
    if (oldPath === newPath || typeof entry.folderRename !== "boolean") {
      throw new Error(`Vault-rename journal entry ${index + 1} is malformed.`);
    }
    return { oldPath, newPath, folderRename: entry.folderRename };
  });
}

function parseScope(raw: unknown): VaultRenameScope {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("Vault-rename journal has an invalid scope.");
  }
  const scope = raw as Record<string, unknown>;
  if (scope.kind === "bound" && hasExactKeys(scope, ["kind", "vaultId"])) {
    return { kind: "bound", vaultId: cleanVaultId(scope.vaultId) };
  }
  if (scope.kind === "bootstrap" && hasExactKeys(scope, ["kind", "bootstrapId", "expectedVaultId"])) {
    return {
      kind: "bootstrap",
      bootstrapId: cleanVaultId(scope.bootstrapId),
      expectedVaultId: scope.expectedVaultId === null ? null : cleanVaultId(scope.expectedVaultId),
    };
  }
  throw new Error("Vault-rename journal has an invalid scope.");
}

/**
 * Strictly parse one device's bounded, ordered pending-rename journal. A valid
 * v1 envelope is read, unchanged, as a bound v2 journal; it is rewritten as v2
 * only when a durable write is needed.
 */
export function parseVaultRenameJournal(input: unknown): VaultRenameJournal {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("Vault-rename journal is malformed.");
  }
  if (serializedUtf8Bytes(input) > MAX_VAULT_RENAME_JOURNAL_BYTES) {
    throw new Error("Vault-rename journal is too large.");
  }
  const value = input as Record<string, unknown>;
  if (value.version === LEGACY_VAULT_RENAME_JOURNAL_VERSION) {
    if (!hasExactKeys(value, ["version", "vaultId", "renames"])
      || !Array.isArray(value.renames)
      || value.renames.length === 0
      || value.renames.length > MAX_PENDING_VAULT_RENAMES) {
      throw new Error("Vault-rename journal has an unsupported or malformed shape.");
    }
    return {
      version: VAULT_RENAME_JOURNAL_VERSION,
      scope: { kind: "bound", vaultId: cleanVaultId(value.vaultId) },
      renames: parseRenames(value.renames),
      blocked: null,
    };
  }
  if (value.version !== VAULT_RENAME_JOURNAL_VERSION
    || !hasExactKeys(value, ["version", "scope", "renames", "blocked"])
    || !Array.isArray(value.renames)
    || value.renames.length > MAX_PENDING_VAULT_RENAMES
    || (value.blocked !== null && value.blocked !== "overflow" && value.blocked !== "ambiguous-path")) {
    throw new Error("Vault-rename journal has an unsupported or malformed shape.");
  }
  // An empty prefix is only meaningful when a blocked marker explains it.
  if (value.renames.length === 0 && value.blocked === null) {
    throw new Error("Vault-rename journal has an unsupported or malformed shape.");
  }
  return {
    version: VAULT_RENAME_JOURNAL_VERSION,
    scope: parseScope(value.scope),
    renames: parseRenames(value.renames),
    blocked: value.blocked,
  };
}

/** Build through the strict parser so write-side and restart bounds cannot drift. */
export function createVaultRenameJournalForScope(
  scope: VaultRenameScope,
  renames: readonly PendingVaultRename[],
  blocked: VaultRenameBlockedReason | null = null,
): VaultRenameJournal {
  return parseVaultRenameJournal({
    version: VAULT_RENAME_JOURNAL_VERSION,
    scope: { ...scope },
    renames: renames.map((entry) => ({ ...entry })),
    blocked,
  });
}

/** Build a bound journal for one accepted vault identity. */
export function createVaultRenameJournal(
  vaultId: string,
  renames: readonly PendingVaultRename[],
  blocked: VaultRenameBlockedReason | null = null,
): VaultRenameJournal {
  return createVaultRenameJournalForScope({ kind: "bound", vaultId }, renames, blocked);
}

/** The identity a bound journal repairs, or null for a bootstrap journal. */
export function boundVaultIdOf(journal: VaultRenameJournal): string | null {
  return journal.scope.kind === "bound" ? journal.scope.vaultId : null;
}

/**
 * Whether one more event fits the entry and byte bounds, with headroom left for
 * a blocked marker. Checked before anything is added to a durable or in-memory
 * array so neither can grow past the bound.
 */
export function vaultRenameAppendFits(
  scope: VaultRenameScope,
  renames: readonly PendingVaultRename[],
  entry: PendingVaultRename,
): boolean {
  if (renames.length + 1 > MAX_PENDING_VAULT_RENAMES) return false;
  // Exact UTF-8 size of the serialized envelope, summed incrementally so a long
  // run of events does not re-serialize the whole prefix every time.
  const envelope = serializedUtf8Bytes({ version: VAULT_RENAME_JOURNAL_VERSION, scope, renames: [], blocked: null });
  const bytes = envelope + entriesBytes(renames) + serializedUtf8Bytes(entry) + (renames.length > 0 ? 1 : 0);
  return bytes + VAULT_RENAME_BLOCKED_RESERVE_BYTES <= MAX_VAULT_RENAME_JOURNAL_BYTES;
}

const ENTRY_BYTES_CACHE = new WeakMap<readonly PendingVaultRename[], { length: number; last: PendingVaultRename | undefined; bytes: number }>();

/** Serialized size of the entries joined by commas, extended incrementally for a growing array. */
function entriesBytes(renames: readonly PendingVaultRename[]): number {
  if (renames.length === 0) return 0;
  const cached = ENTRY_BYTES_CACHE.get(renames);
  let from = 0;
  let bytes = 0;
  if (cached && cached.length <= renames.length && cached.last === renames[cached.length - 1]) {
    from = cached.length;
    bytes = cached.bytes;
  }
  for (let index = from; index < renames.length; index += 1) {
    bytes += serializedUtf8Bytes(renames[index]) + (index > 0 ? 1 : 0);
  }
  ENTRY_BYTES_CACHE.set(renames, { length: renames.length, last: renames[renames.length - 1], bytes });
  return bytes;
}
