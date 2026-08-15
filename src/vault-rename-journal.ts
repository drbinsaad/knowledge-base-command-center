/**
 * App-local crash journal for physical vault renames whose plugin-data path
 * rewrite has not yet committed. It is intentionally separate from the v4
 * view/Undo journal: an ordinary route save must never erase rename recovery,
 * and a rename record must never displace a protected required-Undo marker.
 */

export const VAULT_RENAME_JOURNAL_VERSION = 1;
export const MAX_PENDING_VAULT_RENAMES = 10_000;
export const MAX_VAULT_RENAME_JOURNAL_BYTES = 4 * 1024 * 1024;
const MAX_VAULT_PATH_LENGTH = 4_096;

export interface PendingVaultRename {
  oldPath: string;
  newPath: string;
  folderRename: boolean;
}

export interface VaultRenameJournal {
  version: typeof VAULT_RENAME_JOURNAL_VERSION;
  vaultId: string;
  renames: PendingVaultRename[];
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

/** Strictly parse one vault's bounded, ordered pending-rename journal. */
export function parseVaultRenameJournal(input: unknown): VaultRenameJournal {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("Vault-rename journal is malformed.");
  }
  if (serializedUtf8Bytes(input) > MAX_VAULT_RENAME_JOURNAL_BYTES) {
    throw new Error("Vault-rename journal is too large.");
  }
  const value = input as Record<string, unknown>;
  if (!hasExactKeys(value, ["version", "vaultId", "renames"])
    || value.version !== VAULT_RENAME_JOURNAL_VERSION
    || !Array.isArray(value.renames)
    || value.renames.length === 0
    || value.renames.length > MAX_PENDING_VAULT_RENAMES) {
    throw new Error("Vault-rename journal has an unsupported or malformed shape.");
  }
  const vaultId = cleanVaultId(value.vaultId);
  const renames = value.renames.map((raw, index): PendingVaultRename => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      throw new Error(`Vault-rename journal entry ${index + 1} is malformed.`);
    }
    const entry = raw as Record<string, unknown>;
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
  return { version: VAULT_RENAME_JOURNAL_VERSION, vaultId, renames };
}

/** Build through the strict parser so write-side and restart bounds cannot drift. */
export function createVaultRenameJournal(
  vaultId: string,
  renames: readonly PendingVaultRename[],
): VaultRenameJournal {
  return parseVaultRenameJournal({
    version: VAULT_RENAME_JOURNAL_VERSION,
    vaultId,
    renames: renames.map((entry) => ({ ...entry })),
  });
}
