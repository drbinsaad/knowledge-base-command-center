export const SYNC_RECOVERY_LOCAL_STATE_VERSION = 1 as const;
export const SYNC_RECOVERY_EXPORT_FOLDER = "Knowledge Base Command Center Exports";
export const MAX_SYNC_RECOVERY_ARTIFACT_ENTRIES = 2_000;
const MAX_RECORDED_CONFLICT_BASES = 50;

const EXPORT_STAMP = String.raw`\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z`;
const CONFLICT_RESCUE_NAME = new RegExp(`^knowledge-base-command-center-conflict-${EXPORT_STAMP}(?:-\\d+)?\\.json$`, "u");
const LEGACY_RECOVERY_NAME = new RegExp(`^knowledge-base-command-center-backup-${EXPORT_STAMP}(?:-\\d+)?\\.json$`, "u");

export type ExternalReloadOutcome = "applied" | "blocked";

export interface RecordedSemanticConflict {
  baseId: string;
  at: number;
  count: number;
}

/** Device-only observations. This value is stored through App localStorage, never data.json. */
export interface SyncRecoveryLocalState {
  version: typeof SYNC_RECOVERY_LOCAL_STATE_VERSION;
  lastLocalSaveAt: number | null;
  lastExternalReloadAt: number | null;
  lastExternalReloadOutcome: ExternalReloadOutcome | null;
  lastRecoveryExportAt: number | null;
  semanticConflicts: RecordedSemanticConflict[];
}

export interface LocalRecoveryArtifact {
  path: string;
  mtime: number;
}

export interface RecoveryArtifactSummary {
  conflictRescueCount: number;
  newestConflictRescueAt: number | null;
  newestNamedRecoveryAt: number | null;
  scannedEntries: number;
  scanTruncated: boolean;
}

export interface PlatformFacts {
  isAndroidApp?: boolean;
  isDesktopApp?: boolean;
  isIosApp?: boolean;
  isMobile?: boolean;
  isPhone?: boolean;
  isTablet?: boolean;
}

export interface SyncRecoveryCenterSnapshot {
  activeBaseName: string;
  workspaceProfile: string;
  semanticRevision: number;
  semanticHeadSummary: string;
  semanticCommitState: "committed" | "pending" | "unavailable";
  lastLocalSaveAt: number | null;
  lastExternalReloadAt: number | null;
  lastExternalReloadOutcome: ExternalReloadOutcome | null;
  conflictRescueCount: number;
  conflictRescueCountIsLowerBound: boolean;
  artifactInspectionAvailable: boolean;
  newestConflictRescueAt: number | null;
  newestRecoveryExportAt: number | null;
  readOnly: boolean;
  readOnlyReason: string;
  stickyUntilRestart: boolean;
  activeBaseConcurrentEditAt: number | null;
  activeBaseConcurrentEditCount: number;
  deviceProfile: string;
  configProfile: string;
  deviceLocalStateProfile: string;
}

export function createDefaultSyncRecoveryLocalState(): SyncRecoveryLocalState {
  return {
    version: SYNC_RECOVERY_LOCAL_STATE_VERSION,
    lastLocalSaveAt: null,
    lastExternalReloadAt: null,
    lastExternalReloadOutcome: null,
    lastRecoveryExportAt: null,
    semanticConflicts: [],
  };
}

function cleanTimestamp(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function cleanConflictCount(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) return 1;
  return Math.min(value, MAX_RECORDED_CONFLICT_BASES);
}

export function parseSyncRecoveryLocalState(input: unknown): SyncRecoveryLocalState {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("Invalid device-local Sync and Recovery state.");
  }
  const record = input as Record<string, unknown>;
  if (record.version !== SYNC_RECOVERY_LOCAL_STATE_VERSION) {
    throw new Error("Unsupported device-local Sync and Recovery state version.");
  }
  const rawConflicts = Array.isArray(record.semanticConflicts) ? record.semanticConflicts : [];
  const semanticConflicts: RecordedSemanticConflict[] = [];
  const seen = new Set<string>();
  for (const value of rawConflicts.slice(0, MAX_RECORDED_CONFLICT_BASES)) {
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const conflict = value as Record<string, unknown>;
    const baseId = typeof conflict.baseId === "string" ? conflict.baseId.trim() : "";
    const at = cleanTimestamp(conflict.at);
    if (!baseId || baseId.length > 200 || at === null || seen.has(baseId)) continue;
    seen.add(baseId);
    semanticConflicts.push({ baseId, at, count: cleanConflictCount(conflict.count) });
  }
  const outcome = record.lastExternalReloadOutcome === "applied" || record.lastExternalReloadOutcome === "blocked"
    ? record.lastExternalReloadOutcome
    : null;
  return {
    version: SYNC_RECOVERY_LOCAL_STATE_VERSION,
    lastLocalSaveAt: cleanTimestamp(record.lastLocalSaveAt),
    lastExternalReloadAt: cleanTimestamp(record.lastExternalReloadAt),
    lastExternalReloadOutcome: cleanTimestamp(record.lastExternalReloadAt) === null ? null : outcome,
    lastRecoveryExportAt: cleanTimestamp(record.lastRecoveryExportAt),
    semanticConflicts,
  };
}

function directExportName(path: string): string | null {
  const prefix = `${SYNC_RECOVERY_EXPORT_FOLDER}/`;
  if (!path.startsWith(prefix)) return null;
  const name = path.slice(prefix.length);
  return !name || name.includes("/") ? null : name;
}

export function isDocumentedConflictRescuePath(path: string): boolean {
  const name = directExportName(path);
  return Boolean(name && CONFLICT_RESCUE_NAME.test(name));
}

export function isDocumentedNamedRecoveryPath(path: string): boolean {
  const name = directExportName(path);
  return Boolean(name && LEGACY_RECOVERY_NAME.test(name));
}

export function summarizeRecoveryArtifacts(
  artifacts: readonly LocalRecoveryArtifact[],
  maxEntries = MAX_SYNC_RECOVERY_ARTIFACT_ENTRIES,
): RecoveryArtifactSummary {
  const safeLimit = Number.isSafeInteger(maxEntries) && maxEntries >= 0
    ? Math.min(maxEntries, MAX_SYNC_RECOVERY_ARTIFACT_ENTRIES)
    : MAX_SYNC_RECOVERY_ARTIFACT_ENTRIES;
  let conflictRescueCount = 0;
  let newestConflictRescueAt: number | null = null;
  let newestNamedRecoveryAt: number | null = null;
  const scannedEntries = Math.min(artifacts.length, safeLimit);
  for (let index = 0; index < scannedEntries; index += 1) {
    const artifact = artifacts[index];
    if (!artifact) continue;
    const mtime = cleanTimestamp(artifact.mtime);
    if (isDocumentedConflictRescuePath(artifact.path)) {
      conflictRescueCount += 1;
      if (mtime !== null) newestConflictRescueAt = Math.max(newestConflictRescueAt ?? 0, mtime);
    } else if (isDocumentedNamedRecoveryPath(artifact.path) && mtime !== null) {
      newestNamedRecoveryAt = Math.max(newestNamedRecoveryAt ?? 0, mtime);
    }
  }
  return {
    conflictRescueCount,
    newestConflictRescueAt,
    newestNamedRecoveryAt,
    scannedEntries,
    scanTruncated: artifacts.length > scannedEntries,
  };
}

export function formatLocalAge(timestamp: number | null, now = Date.now()): string {
  if (timestamp === null) return "Not recorded on this device";
  const elapsed = Math.max(0, now - timestamp);
  if (elapsed < 60_000) return "Just now";
  const minutes = Math.floor(elapsed / 60_000);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

export function summarizeSemanticHead(head: string): string {
  return /^[0-9a-f]{16}$/iu.test(head) ? `${head.slice(0, 8).toLowerCase()}…` : "Unavailable";
}

export function privacySafeBaseName(value: string): string {
  const normalized = [...value.normalize("NFC")]
    .map((character) => {
      const code = character.codePointAt(0) ?? 0;
      return code < 32 || code === 127 ? " " : character;
    })
    .join("")
    .replace(/\s+/gu, " ")
    .trim();
  const pathLike = /[/\\]/u.test(normalized)
    || /^[a-z][a-z0-9+.-]*:\/\//iu.test(normalized)
    || /^file:/iu.test(normalized);
  if (pathLike) return "Active knowledge base (path-like name hidden)";
  if (!normalized) return "Unnamed knowledge base";
  return normalized.length <= 100 ? normalized : `${normalized.slice(0, 99)}…`;
}

export function privacySafeReadOnlyReason(
  warning: string,
  flags: { persistenceUncertain: boolean; semanticConflictRescueFailed: boolean },
): string {
  if (flags.semanticConflictRescueFailed) {
    return "Concurrent organization edits could not be preserved before choosing a winner. The plugin is protecting the captured data until restart.";
  }
  if (flags.persistenceUncertain) {
    return "A local write or its compensating rollback could not be confirmed. Organization remains protected until restart.";
  }
  const normalized = warning.toLocaleLowerCase();
  if (!normalized) return "Writable";
  if (normalized.includes("newer than this build")) {
    return "The stored plugin data is newer than this build, so this build will not overwrite it.";
  }
  if (normalized.includes("could not be parsed") || normalized.includes("unrecognized shape")) {
    return "The stored plugin data could not be parsed or recognized safely, so it will not be overwritten.";
  }
  if (normalized.includes("could not be migrated")) {
    return "The stored plugin data could not be migrated safely, so it will not be overwritten.";
  }
  if (normalized.includes("older build without a vault identity")) {
    return "An older plugin-data envelope lacks the identity required for safe reconciliation.";
  }
  if (normalized.includes("sync") || normalized.includes("synced")) {
    return "A local external-data reload could not be reconciled safely, so organization is protected.";
  }
  return "The plugin entered compatibility protection because local plugin data could not be interpreted safely.";
}

export function describePlatform(facts: PlatformFacts): string {
  if (facts.isIosApp) return facts.isPhone ? "iPhone app" : facts.isTablet ? "iPad app" : "iOS or iPadOS app";
  if (facts.isAndroidApp) return facts.isPhone ? "Android phone app" : facts.isTablet ? "Android tablet app" : "Android app";
  if (facts.isDesktopApp) return "Desktop app";
  return facts.isMobile ? "Mobile interface" : "Desktop interface";
}

export function describeConfigProfile(configDir: unknown): string {
  if (typeof configDir !== "string" || !configDir.trim()) return "Configuration folder unavailable through the public Vault API";
  const defaultConfigDir = [".", "obsidian"].join("");
  return configDir.replace(/\\/gu, "/").replace(/^\/+|\/+$/gu, "") === defaultConfigDir
    ? "Default Obsidian configuration folder"
    : "Custom Obsidian configuration folder (name hidden)";
}
