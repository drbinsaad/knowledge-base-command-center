/**
 * Recovery-copy parser, preview model and restore intent (A06/D04).
 *
 * A leaf module: pure functions over bytes or strings that a caller supplies.
 * It performs no vault, adapter, DOM or network access and never writes. The
 * later main-plugin hook is responsible for reading the selected file,
 * rereading it at Apply time, and committing the returned entry through the
 * existing store transaction.
 *
 * Accepted inputs, and nothing else:
 *  (a) a recognized complete raw plugin store (kind + version >= 11), or
 *  (b) a version-1 conflict-rescue wrapper whose `store` is such a store.
 * Everything else (malformed, empty, arbitrary JSON, flat legacy data, future
 * schema versions, oversized or over-complex input) is reported as
 * "preserved but not restorable". Nothing here ever falls back to a default
 * store.
 */
import {
  DATA_VERSION,
  MAX_KNOWLEDGE_BASES,
  MIN_RECOGNIZED_STORE_VERSION,
  STORE_KIND,
  STORE_VERSION,
  cloneJsonValue,
  fingerprintText,
  createKnowledgeBaseEntry,
  isRecognizedPluginStore,
  migrateStore,
  normalizedNameKey,
  type KnowledgeBaseEntry,
  type PluginStore,
} from "./model";

/** Kind written by the Sync conflict-rescue writer in main.ts. */
export const RECOVERY_COPY_CONFLICT_RESCUE_KIND = "knowledge-base-command-center-conflict-rescue";
const SUPPORTED_RESCUE_WRAPPER_VERSION = 1;

export interface RecoveryCopyLimits {
  /** Maximum UTF-8 bytes. Checked on the declared (stat) size and on the bytes actually read. */
  maxBytes: number;
  /** Maximum container nesting depth (checked iteratively, never by recursion). */
  maxDepth: number;
  /** Maximum JSON values (containers, strings including keys, and scalar tokens). */
  maxNodes: number;
  /** Maximum bases in the store. Equal to the plugin-wide base limit. */
  maxBases: number;
}

/**
 * Documented bounds. 16 MiB is far above any real plugin store (the store is
 * bounded per base and holds no note bodies) yet small enough for a phone.
 * The deepest legitimate store nests well under 40 levels (layout depth 5);
 * 64 leaves headroom. 1,000,000 values comfortably covers fifty full bases.
 */
export const RECOVERY_COPY_LIMITS: Readonly<RecoveryCopyLimits> = Object.freeze({
  maxBytes: 16 * 1024 * 1024,
  maxDepth: 64,
  maxNodes: 1_000_000,
  maxBases: MAX_KNOWLEDGE_BASES,
});

export type RecoveryCopyRejectReason =
  | "too-large"
  | "not-utf8"
  | "empty"
  | "malformed-json"
  | "too-deep"
  | "too-many-nodes"
  | "unrecognized"
  | "future-outer-version"
  | "future-inner-version"
  | "too-many-bases"
  | "incomplete-base"
  | "damaged-store";

export type RecoveryCopySourceKind = "raw-store" | "conflict-rescue";
export type RecoveryCopyIdentity = "same-vault" | "foreign-vault" | "unverified";
export type RecoveryCopyPreset = "generic" | "ent-clinical";

export interface RecoveryCopyBaseCounts {
  collections: number;
  pinned: number;
  savedViews: number;
  indexedNotes: number;
  linkedFolders: number;
  libraries: number;
  /** Named layout snapshots (semantic, kept on restore). */
  namedSnapshots: number;
  /** Executable history (local-only, not kept on restore). */
  undoSteps: number;
  redoSteps: number;
}

export interface RecoveryCopyBasePreview {
  baseId: string;
  name: string;
  preset: RecoveryCopyPreset;
  archived: boolean;
  counts: RecoveryCopyBaseCounts;
}

export interface RecoveryCopyPreview {
  sourceKind: RecoveryCopySourceKind;
  /** Only a plausible wrapper `exportedAt`; raw stores carry no trustworthy date. */
  date: { iso: string; source: "rescue-exportedAt" } | null;
  bases: RecoveryCopyBasePreview[];
  /** True when the store version and every base data version are supported. */
  supportedSchema: true;
  identity: RecoveryCopyIdentity;
  identityGuidance: string;
  /** Restore is offered only for an exact same-vault identity match. */
  restorable: boolean;
  privateContentDisclosure: string;
  sourceByteLength: number;
  /** Fingerprint of the exact source bytes; see recoveryCopySourceTokenMatches. */
  sourceToken: string;
}

export interface RecoveryCopyParsed {
  ok: true;
  preview: RecoveryCopyPreview;
  /** Migrated, validated store. Used only to build a restore intent; never written back. */
  store: PluginStore;
  /** Private copy of the exact source bytes, kept so Apply can compare byte for byte. Never log it. */
  sourceBytes: Uint8Array;
}

export interface RecoveryCopyRejected {
  ok: false;
  reason: RecoveryCopyRejectReason;
  message: string;
  restorable: false;
  /** The copy is kept on disk untouched; it is simply not usable as restore input. */
  preservedNotRestorable: true;
  /** Fingerprint when the bytes were read within the cap; null otherwise. */
  sourceToken: string | null;
}

export type RecoveryCopyParseResult = RecoveryCopyParsed | RecoveryCopyRejected;

export interface ParseRecoveryCopyInput {
  /** Bytes or text the caller already read. Never modified. */
  content: string | Uint8Array;
  /** Size reported by stat before reading, when known. Checked before content is touched. */
  declaredSize?: number | null;
  /** The opened vault's identity. Never inferred from base names. */
  currentVaultId: string | null;
  now?: number;
  /** Tighten (never loosen) the documented limits; intended for tests. */
  limits?: Partial<RecoveryCopyLimits>;
  /** Test seam for the lookup token; defaults to fingerprintRecoveryCopyBytes. */
  fingerprint?: RecoveryCopyFingerprint;
}

const PRIVATE_CONTENT_DISCLOSURE =
  "Full rescue copies can contain exact vault-relative paths and local view and Undo history. "
  + "Clear device-local data does not remove these copies. Keep them private and do not share them.";

const PORTABLE_TRANSFER_GUIDANCE =
  "This copy belongs to a different vault, so it cannot be restored in this version and is left untouched. "
  + "To move organization between vaults, use portable export and import instead.";

function resolveLimits(partial?: Partial<RecoveryCopyLimits>): RecoveryCopyLimits {
  const pick = (value: number | undefined, ceiling: number): number =>
    typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.min(value, ceiling) : ceiling;
  return {
    maxBytes: pick(partial?.maxBytes, RECOVERY_COPY_LIMITS.maxBytes),
    maxDepth: pick(partial?.maxDepth, RECOVERY_COPY_LIMITS.maxDepth),
    maxNodes: pick(partial?.maxNodes, RECOVERY_COPY_LIMITS.maxNodes),
    maxBases: pick(partial?.maxBases, RECOVERY_COPY_LIMITS.maxBases),
  };
}

function reject(
  reason: RecoveryCopyRejectReason,
  message: string,
  sourceToken: string | null = null,
): RecoveryCopyRejected {
  return { ok: false, reason, message, restorable: false, preservedNotRestorable: true, sourceToken };
}

const MESSAGES: Record<RecoveryCopyRejectReason, string> = {
  "too-large": "This file is larger than the recovery reader allows. It is kept untouched but cannot be restored here.",
  "not-utf8": "This file is not valid UTF-8 text. It is kept untouched but cannot be restored here.",
  "empty": "This file is empty. It is kept untouched but there is nothing to restore.",
  "malformed-json": "This file is not valid JSON. It is kept untouched but cannot be restored here.",
  "too-deep": "This file is nested more deeply than a plugin copy ever is. It is kept untouched but cannot be restored here.",
  "too-many-nodes": "This file holds more data than a plugin copy allows. It is kept untouched but cannot be restored here.",
  "unrecognized": "This file is not a complete plugin store or a recognized Sync conflict rescue. It is kept untouched but cannot be restored here.",
  "future-outer-version": "This copy was written by a newer version of the plugin. It is kept untouched; update the plugin before using it.",
  "future-inner-version": "This copy contains data from a newer version of the plugin. It is kept untouched; update the plugin before using it.",
  "too-many-bases": "This copy lists more knowledge bases than the plugin supports. It is kept untouched but cannot be restored here.",
  "incomplete-base": "A knowledge base in this copy is missing required data. It is kept untouched but cannot be restored here.",
  "damaged-store": "This copy looks like a plugin store but is damaged. It is kept untouched but cannot be restored here.",
};

function rejectWith(reason: RecoveryCopyRejectReason, sourceToken: string | null = null): RecoveryCopyRejected {
  return reject(reason, MESSAGES[reason], sourceToken);
}

/** Pre-read gate on the size a stat call reported. null means the size is not known yet. */
export function checkRecoveryCopyDeclaredSize(
  size: number | null | undefined,
  limits?: Partial<RecoveryCopyLimits>,
): { ok: true } | { ok: false; reason: "too-large"; message: string } {
  if (size === null || size === undefined) return { ok: true };
  const { maxBytes } = resolveLimits(limits);
  if (!Number.isFinite(size) || size < 0 || size > maxBytes) {
    return { ok: false, reason: "too-large", message: MESSAGES["too-large"] };
  }
  return { ok: true };
}

/** UTF-8 byte length of a string without allocating, stopping once `cap` is exceeded. */
function utf8LengthExceeds(text: string, cap: number): boolean {
  if (text.length > cap) return true; // every UTF-16 unit needs at least one UTF-8 byte
  let bytes = 0;
  for (let index = 0; index < text.length; index += 1) {
    const unit = text.charCodeAt(index);
    if (unit < 0x80) bytes += 1;
    else if (unit < 0x800) bytes += 2;
    else if (unit >= 0xd800 && unit <= 0xdbff && index + 1 < text.length
      && (text.charCodeAt(index + 1) & 0xfc00) === 0xdc00) {
      bytes += 4;
      index += 1;
    } else bytes += 3; // BMP character or a lone surrogate (encoded as U+FFFD)
    if (bytes > cap) return true;
  }
  return false;
}

/** Test seam: maps source bytes to a lookup token. */
export type RecoveryCopyFingerprint = (bytes: Uint8Array) => string;

/**
 * Lookup token for the source: byte length plus the existing frozen 64-bit
 * fingerprintText over the lossily decoded text. It is NOT cryptographic and
 * two different files can share it, so it is only a cheap "probably changed"
 * signal. Equality of sources is decided by recoverySourceMatchesExactly,
 * which compares the retained bytes byte for byte.
 */
export function fingerprintRecoveryCopyBytes(bytes: Uint8Array): string {
  return `fp:${bytes.length}:${fingerprintText(new TextDecoder("utf-8").decode(bytes))}`;
}

function toBytes(content: string | Uint8Array): Uint8Array {
  return typeof content === "string" ? new TextEncoder().encode(content) : content;
}

/**
 * Cheap pre-check that a re-read still looks like the previewed copy. A true
 * result is never proof of identity; Apply must use recoverySourceMatchesExactly.
 */
export function recoveryCopySourceTokenMatches(
  token: string,
  content: string | Uint8Array | null | undefined,
  limits?: Partial<RecoveryCopyLimits>,
  fingerprint: RecoveryCopyFingerprint = fingerprintRecoveryCopyBytes,
): boolean {
  if (content === null || content === undefined) return false;
  const { maxBytes } = resolveLimits(limits);
  if (typeof content === "string" ? utf8LengthExceeds(content, maxBytes) : content.byteLength > maxBytes) return false;
  return fingerprint(toBytes(content)) === token;
}

/**
 * The decisive Apply-time check: the bounded re-read must equal the bytes
 * retained at preview, byte for byte. The token never decides a match.
 */
export function recoverySourceMatchesExactly(
  intent: Pick<RecoveryRestoreIntent, "retainedSource">,
  reread: string | Uint8Array | null | undefined,
  limits?: Partial<RecoveryCopyLimits>,
): boolean {
  if (reread === null || reread === undefined) return false;
  const { maxBytes } = resolveLimits(limits);
  if (typeof reread === "string" ? utf8LengthExceeds(reread, maxBytes) : reread.byteLength > maxBytes) return false;
  const current = toBytes(reread);
  const kept = intent.retainedSource;
  if (current.length !== kept.length) return false;
  for (let index = 0; index < kept.length; index += 1) {
    if (current[index] !== kept[index]) return false;
  }
  return true;
}

/**
 * Iterative lexical scan: enforces depth and node bounds before JSON.parse
 * allocates anything. Brackets inside strings are ignored. Structural errors
 * are left to JSON.parse.
 */
function scanJsonBounds(text: string, limits: RecoveryCopyLimits): "too-deep" | "too-many-nodes" | null {
  let depth = 0;
  let nodes = 0;
  let inString = false;
  let escaped = false;
  let inToken = false;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (inString) {
      if (escaped) escaped = false;
      else if (code === 92) escaped = true;
      else if (code === 34) {
        inString = false;
        nodes += 1;
        if (nodes > limits.maxNodes) return "too-many-nodes";
      }
      continue;
    }
    switch (code) {
      case 34: // "
        inToken = false;
        inString = true;
        break;
      case 123: // {
      case 91: // [
        inToken = false;
        depth += 1;
        nodes += 1;
        if (depth > limits.maxDepth) return "too-deep";
        if (nodes > limits.maxNodes) return "too-many-nodes";
        break;
      case 125: // }
      case 93: // ]
        inToken = false;
        if (depth > 0) depth -= 1;
        break;
      case 44: // ,
      case 58: // :
      case 32:
      case 9:
      case 10:
      case 13:
        inToken = false;
        break;
      default:
        if (!inToken) {
          inToken = true;
          nodes += 1;
          if (nodes > limits.maxNodes) return "too-many-nodes";
        }
    }
  }
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Strict positive-integer version, or null when absent or malformed. */
function readVersion(value: unknown): number | null {
  if (typeof value === "string" ? value.length > 64 : typeof value !== "number") return null;
  const version = Number(value);
  return Number.isInteger(version) && version > 0 ? version : null;
}

/**
 * Recovery-specific completeness rule for one raw base body, by its declared
 * version (migrateStore is intentionally more lenient and is not changed):
 * An explicit integer version from 2 to the current data version is required,
 * plus only the fields EVERY writer of that version always wrote (cumulative
 * by version; from each PluginData interface in the project history, see
 * logs/a06c-history.md). Undo/Redo and named snapshots are never required.
 *  - all (2-7): array collections; non-empty plain-record settings
 *    (history before 0.7.1 is not in the repository, so only what the v2
 *    migration reads is required);
 *  - 8+: arrays pinnedPaths, nextStudyPaths, savedViews, excludedIndexPaths,
 *    indexGroupOrder; records curriculumVisual, indexGroupByPath; string
 *    selectedPath; string settings.workspaceMode;
 *  - 9+: record collapsed;  10+: record portableIndex;
 *  - 12+: records displayNameByPath, indexGroupAliases;
 *  - 15+: arrays directIndexPaths, indexFolderSources.
 */
function baseDataIsComplete(data: Record<string, unknown>): boolean {
  const version = readVersion(data.version);
  if (version === null || version < 2 || version > DATA_VERSION) return false;
  if (!Array.isArray(data.collections)) return false;
  if (!isRecord(data.settings) || Object.keys(data.settings).length === 0) return false;
  const arrays: string[] = [];
  const records: string[] = [];
  if (version >= 8) {
    arrays.push("pinnedPaths", "nextStudyPaths", "savedViews", "excludedIndexPaths", "indexGroupOrder");
    records.push("curriculumVisual", "indexGroupByPath");
    if (typeof data.selectedPath !== "string" || typeof data.settings.workspaceMode !== "string") return false;
  }
  if (version >= 9) records.push("collapsed");
  if (version >= 10) records.push("portableIndex");
  if (version >= 12) records.push("displayNameByPath", "indexGroupAliases");
  if (version >= 15) arrays.push("directIndexPaths", "indexFolderSources");
  return arrays.every((key) => Array.isArray(data[key])) && records.every((key) => isRecord(data[key]));
}

function trustworthyDate(value: unknown, now: number): RecoveryCopyPreview["date"] {
  if (typeof value !== "string" || value.length > 64) return null;
  const ms = Date.parse(value);
  if (!Number.isFinite(ms) || ms < Date.UTC(2020, 0, 1) || ms > now + 86_400_000) return null;
  return { iso: new Date(ms).toISOString(), source: "rescue-exportedAt" };
}

function previewBase(entry: KnowledgeBaseEntry): RecoveryCopyBasePreview {
  const data = entry.data;
  return {
    baseId: entry.id,
    name: data.settings.workspaceName,
    preset: data.settings.workspaceMode === "ent-clinical" ? "ent-clinical" : "generic",
    archived: entry.archivedAt !== null,
    counts: {
      collections: data.collections.length,
      pinned: data.pinnedPaths.length,
      savedViews: data.savedViews.length,
      indexedNotes: data.directIndexPaths.length,
      linkedFolders: data.indexFolderSources.length,
      libraries: data.portableIndex.libraries.length,
      namedSnapshots: data.layoutSnapshots.length,
      undoSteps: data.undoStack.length,
      redoSteps: data.redoStack.length,
    },
  };
}

/**
 * Parse caller-supplied bytes or text into a preview. The input is never
 * modified; nothing is written; every failure is a typed rejection.
 */
export function parseRecoveryCopy(input: ParseRecoveryCopyInput): RecoveryCopyParseResult {
  const limits = resolveLimits(input.limits);
  const now = input.now ?? Date.now();

  // 1. Declared size, before the content is touched.
  if (!checkRecoveryCopyDeclaredSize(input.declaredSize, limits).ok) return rejectWith("too-large");

  // 2. Actual UTF-8 bytes.
  const content = input.content;
  if (typeof content === "string" ? utf8LengthExceeds(content, limits.maxBytes) : content.byteLength > limits.maxBytes) {
    return rejectWith("too-large");
  }
  const bytes = Uint8Array.from(toBytes(content)); // private copy; the caller's buffer is never held or changed
  const sourceToken = (input.fingerprint ?? fingerprintRecoveryCopyBytes)(bytes);

  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes); // strips a leading BOM
  } catch {
    return rejectWith("not-utf8", sourceToken);
  }
  if (text.trim() === "") return rejectWith("empty", sourceToken);

  // 3. Iterative depth and node bounds, before parsing or any migration.
  const bound = scanJsonBounds(text, limits);
  if (bound) return rejectWith(bound, sourceToken);

  let root: unknown;
  try {
    root = JSON.parse(text);
  } catch {
    return rejectWith("malformed-json", sourceToken);
  }

  // 4. Recognition: raw store or version-1 rescue wrapper, nothing else.
  if (!isRecord(root)) return rejectWith("unrecognized", sourceToken);
  let sourceKind: RecoveryCopySourceKind;
  let rawStore: unknown;
  let date: RecoveryCopyPreview["date"] = null;
  if (root.kind === RECOVERY_COPY_CONFLICT_RESCUE_KIND) {
    const wrapperVersion = readVersion(root.version);
    if (wrapperVersion === null) return rejectWith("unrecognized", sourceToken);
    if (wrapperVersion > SUPPORTED_RESCUE_WRAPPER_VERSION) return rejectWith("future-outer-version", sourceToken);
    if (!isRecord(root.store) || root.store.kind !== STORE_KIND) return rejectWith("unrecognized", sourceToken);
    sourceKind = "conflict-rescue";
    rawStore = root.store;
    date = trustworthyDate(root.exportedAt, now);
  } else if (root.kind === STORE_KIND) {
    sourceKind = "raw-store";
    rawStore = root;
  } else {
    return rejectWith("unrecognized", sourceToken);
  }

  const store = rawStore as Record<string, unknown>;
  const storeVersion = readVersion(store.version);
  if (storeVersion === null) return rejectWith("unrecognized", sourceToken);
  // isRecognizedPluginStore only has a lower bound, so the upper bound is explicit and comes first.
  if (storeVersion > STORE_VERSION) {
    return rejectWith(sourceKind === "raw-store" ? "future-outer-version" : "future-inner-version", sourceToken);
  }
  if (storeVersion < MIN_RECOGNIZED_STORE_VERSION || !Array.isArray(store.bases)) {
    return rejectWith("unrecognized", sourceToken);
  }
  if (store.bases.length === 0) return rejectWith("damaged-store", sourceToken);
  if (store.bases.length > limits.maxBases) return rejectWith("too-many-bases", sourceToken);
  for (const rawBase of store.bases as unknown[]) {
    if (!isRecord(rawBase) || !isRecord(rawBase.data)) continue; // migrateStore reports the damage
    const dataVersion = readVersion(rawBase.data.version);
    if (dataVersion !== null && dataVersion > DATA_VERSION) return rejectWith("future-inner-version", sourceToken);
  }
  // The general loader deliberately fills defaults for minimal bodies ({} or
  // {settings:{}}). A recovery copy must never be presented as restorable on
  // that basis, so completeness is checked here, before migrateStore.
  for (const rawBase of store.bases as unknown[]) {
    if (!isRecord(rawBase) || !isRecord(rawBase.data)) continue;
    if (!baseDataIsComplete(rawBase.data)) return rejectWith("incomplete-base", sourceToken);
  }
  if (!isRecognizedPluginStore(store)) return rejectWith("unrecognized", sourceToken);

  // 5. Only now run the semantic migration; any failure is a damaged store, never a default.
  let migrated: PluginStore;
  try {
    migrated = migrateStore(store, now);
  } catch {
    return rejectWith("damaged-store", sourceToken);
  }

  // 6. Exact same-vault identity. Only an explicitly stored vaultId can match.
  const storedVaultId = typeof store.vaultId === "string" ? store.vaultId.trim() : "";
  const currentVaultId = typeof input.currentVaultId === "string" ? input.currentVaultId.trim() : "";
  let identity: RecoveryCopyIdentity;
  if (!storedVaultId || !currentVaultId) identity = "unverified";
  else identity = migrated.vaultId === currentVaultId ? "same-vault" : "foreign-vault";
  const identityGuidance = identity === "same-vault"
    ? "This copy belongs to this vault."
    : identity === "foreign-vault"
      ? PORTABLE_TRANSFER_GUIDANCE
      : "This copy's vault could not be verified against this vault, so it cannot be restored in this version. For a different vault, use portable export and import.";

  return {
    ok: true,
    store: migrated,
    sourceBytes: bytes,
    preview: {
      sourceKind,
      date,
      bases: migrated.bases.map(previewBase),
      supportedSchema: true,
      identity,
      identityGuidance,
      restorable: identity === "same-vault",
      privateContentDisclosure: PRIVATE_CONTENT_DISCLOSURE,
      sourceByteLength: bytes.length,
      sourceToken,
    },
  };
}

// ---------------------------------------------------------------------------
// Restore intent (pure data; applying it is the caller's single transaction)
// ---------------------------------------------------------------------------

const MAX_BASE_NAME_LENGTH = 100;
const BASE_ID_PATTERN = /^[a-z0-9][a-z0-9._:@+-]*$/i;
const HEAD_PATTERN = /^[0-9a-f]{16}$/i;
const CONTROL_PATTERN = /[\p{Cc}\p{Cf}]/gu;

/** Local-only items a restore deliberately does not carry into the new base. */
export const RECOVERY_RESTORE_OMITTED_ITEMS: readonly string[] = Object.freeze([
  "Undo and Redo history: the restored base starts with empty Undo and Redo.",
  "The previously selected note and open tab: the restored base opens on its default tab.",
  "Old migration backup payloads: they stay in the source copy only.",
  "The original base's identity, causal history and archived state: the restored base is new and active-ready.",
]);

export interface RestoreIdentity {
  /** Fresh stable base ID. */
  baseId: string;
  /** Fresh 16-hex causal head for the new base. */
  semanticHead: string;
}

export type RecoveryRestoreRejectReason =
  | "identity-not-restorable"
  | "base-not-found"
  | "invalid-name"
  | "name-in-use"
  | "identity-unavailable"
  | "restore-failed";

export interface RecoveryRestoreIntent {
  sourceToken: string;
  sourceBaseId: string;
  /** Exact source bytes (private). Apply decides sameness with recoverySourceMatchesExactly, never the token alone. */
  retainedSource: Uint8Array;
  sourceVaultId: string;
  newBaseId: string;
  name: string;
  preset: RecoveryCopyPreset;
  /** Complete entry for the later main hook to append; the caller must not reuse it across Apply attempts. */
  entry: KnowledgeBaseEntry;
  omitted: readonly string[];
}

export type RecoveryRestoreResult =
  | { ok: true; intent: RecoveryRestoreIntent }
  | { ok: false; reason: RecoveryRestoreRejectReason; message: string };

export interface CreateRecoveryRestoreIntentInput {
  parsed: RecoveryCopyParsed;
  selectedBaseId: string;
  /** Names the caller already uses (non-archived), for uniqueness. */
  existingNames: readonly string[];
  /** Every base ID that must not be reused: current bases and permanent-deletion tombstones. */
  existingBaseIds: readonly string[];
  /** Injected so tests are deterministic. */
  generateIdentity: () => RestoreIdentity;
  /** User-edited name; when omitted, the suggested "restored" name is used. */
  chosenName?: string;
  now?: number;
}

function cleanName(value: string): string {
  return value.normalize("NFC").replace(CONTROL_PATTERN, " ").replace(/\s+/gu, " ").trim();
}

/** "<name> (restored)", then "(restored 2)", ... bounded to the 100-character name limit. */
export function suggestRestoredBaseName(sourceName: string, existingNames: readonly string[]): string {
  const base = cleanName(sourceName) || "Recovered base";
  const used = new Set(existingNames.map(normalizedNameKey));
  for (let attempt = 1; attempt <= existingNames.length + 2; attempt += 1) {
    const suffix = attempt === 1 ? " (restored)" : ` (restored ${attempt})`;
    const candidate = `${base.slice(0, MAX_BASE_NAME_LENGTH - suffix.length).trim()}${suffix}`;
    if (!used.has(normalizedNameKey(candidate))) return candidate;
  }
  return `${base.slice(0, 60).trim()} (restored ${existingNames.length + 3})`;
}

function failure(reason: RecoveryRestoreRejectReason, message: string): RecoveryRestoreResult {
  return { ok: false, reason, message };
}

/**
 * Build the restore intent for one selected base. Pure: it clones the parsed
 * base and never mutates the source or the caller's store.
 */
export function createRecoveryRestoreIntent(input: CreateRecoveryRestoreIntentInput): RecoveryRestoreResult {
  const { parsed } = input;
  if (!parsed.preview.restorable) {
    return failure("identity-not-restorable", parsed.preview.identityGuidance);
  }
  const source = parsed.store.bases.find((entry) => entry.id === input.selectedBaseId);
  if (!source) return failure("base-not-found", "That knowledge base is not in this recovery copy.");

  let name: string;
  if (input.chosenName === undefined) {
    name = suggestRestoredBaseName(source.data.settings.workspaceName, input.existingNames);
  } else {
    const chosen = input.chosenName.normalize("NFC").trim();
    if (!chosen) return failure("invalid-name", "Enter a knowledge-base name.");
    if (chosen.length > MAX_BASE_NAME_LENGTH) return failure("invalid-name", "Keep the knowledge-base name to 100 characters or fewer.");
    if (/[\p{Cc}\p{Cf}]/u.test(chosen)) return failure("invalid-name", "The knowledge-base name contains an unsupported control character.");
    if (input.existingNames.some((existing) => normalizedNameKey(existing) === normalizedNameKey(chosen))) {
      return failure("name-in-use", `A knowledge base named “${chosen}” already exists.`);
    }
    name = chosen;
  }

  const identity = input.generateIdentity();
  const sourceIds = new Set(parsed.store.bases.map((entry) => entry.id));
  const sourceHeads = new Set<string>();
  for (const entry of parsed.store.bases) {
    sourceHeads.add(entry.semanticHead);
    sourceHeads.add(entry.semanticHash);
  }
  if (typeof identity.baseId !== "string" || identity.baseId.length > 128 || !BASE_ID_PATTERN.test(identity.baseId)
    || sourceIds.has(identity.baseId) || input.existingBaseIds.includes(identity.baseId)
    || typeof identity.semanticHead !== "string" || !HEAD_PATTERN.test(identity.semanticHead)
    || sourceHeads.has(identity.semanticHead.toLowerCase())) {
    return failure("identity-unavailable", "A new stable knowledge-base identity could not be allocated safely. Try again.");
  }

  try {
    const data = cloneJsonValue(source.data);
    data.settings.workspaceName = name;
    data.undoStack = [];
    data.redoStack = [];
    data.selectedPath = "";
    data.activeTab = data.settings.defaultTab;
    delete data.migrationBackup;
    delete data.v2MigrationBackup;
    const now = input.now ?? Date.now();
    const entry = createKnowledgeBaseEntry(data, identity.baseId, now);
    entry.semanticHead = identity.semanticHead.toLowerCase();
    return {
      ok: true,
      intent: {
        sourceToken: parsed.preview.sourceToken,
        retainedSource: parsed.sourceBytes,
        sourceBaseId: source.id,
        sourceVaultId: parsed.store.vaultId,
        newBaseId: entry.id,
        name,
        preset: data.settings.workspaceMode === "ent-clinical" ? "ent-clinical" : "generic",
        entry,
        omitted: RECOVERY_RESTORE_OMITTED_ITEMS,
      },
    };
  } catch {
    return failure("restore-failed", "The selected knowledge base could not be prepared for restore.");
  }
}
